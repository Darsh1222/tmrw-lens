import { z } from "zod";
import { readEnv, type Env } from "@/lib/env";
import { SAM_PRICE_PER_IMAGE, tokenCostUsd, worstCaseCostUsd, type CallShape, type Usage } from "@/lib/meta/pricing";
import { spendGuardFor, type SpendGuard } from "@/lib/meta/spend";

// The one place Lens talks to Meta Model API (Responses protocol,
// https://dev.meta.ai/docs/protocols/responses). Plain fetch, no SDK.

export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_data: string; filename?: string };

export type InputMessage = { role: "user" | "developer"; content: ContentPart[] };

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type JsonSchemaFormat = { type: "json_schema"; name: string; schema: Record<string, unknown>; strict: boolean };

export type ResponsesRequest = {
  model: string;
  input: string | InputMessage[];
  instructions?: string;
  text?: { format: JsonSchemaFormat };
  reasoning?: { effort: ReasoningEffort };
  max_output_tokens?: number;
  tools?: unknown[];
  /** SAM options travel here as strings, e.g. { include_confidence: "true" }. */
  metadata?: Record<string, string>;
  /** Groups requests that share a prefix, for Meta's automatic prompt caching. A task name, never content. */
  prompt_cache_key?: string;
  // Lens keeps no conversation state on Meta's side.
  store?: false;
};

export type CallOptions = {
  /** Short task name for the cost log, e.g. "extract_syllabus_page". Never content. */
  task: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Give up instead of waiting longer than this for a retry (Retry-After can be 60s). */
  maxRetryWaitMs?: number;
  env?: Env;
  guard?: SpendGuard;
  fetchImpl?: typeof fetch;
  log?: (line: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type CallResult = {
  id: string;
  model: string;
  output: unknown[];
  outputText: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  attempts: number;
};

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly code: string | null,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** The response finished early (usually max_output_tokens). It was still billed. */
export class MetaIncomplete extends Error {
  constructor(
    readonly reason: string | null,
    readonly result: CallResult,
  ) {
    super(`Response incomplete: ${reason ?? "unknown reason"}`);
    this.name = "MetaIncomplete";
  }
}

const responseSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  status: z.string(),
  output: z.array(z.unknown()).default([]),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().nullish() }).nullish(),
      output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().nullish() }).nullish(),
    })
    .nullish(),
});

const errorBodySchema = z.object({
  error: z.object({
    message: z.string().nullish(),
    type: z.string().nullish(),
    code: z.string().nullish(),
  }),
});

const outputMessageSchema = z.object({
  type: z.literal("message"),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export function outputText(output: unknown[]): string {
  let text = "";
  for (const item of output) {
    const parsed = outputMessageSchema.safeParse(item);
    if (!parsed.success) continue;
    for (const part of parsed.data.content) if (part.type === "output_text" && part.text) text += part.text;
  }
  return text;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function shapeOf(req: ResponsesRequest): CallShape {
  const shape: CallShape = {
    textChars:
      (req.instructions?.length ?? 0) + JSON.stringify(req.text ?? {}).length + JSON.stringify(req.tools ?? []).length,
    images: 0,
    files: 0,
    maxOutputTokens: req.max_output_tokens ?? 16_000,
  };
  if (typeof req.input === "string") shape.textChars += req.input.length;
  else
    for (const m of req.input)
      for (const part of m.content) {
        if (part.type === "input_text") shape.textChars += part.text.length;
        else if (part.type === "input_image") shape.images += 1;
        else shape.files += 1;
      }
  return shape;
}

function isSam(model: string) {
  return model.startsWith("sam-");
}

function estimateUsd(req: ResponsesRequest): number {
  const shape = shapeOf(req);
  return isSam(req.model) ? Math.max(1, shape.images) * SAM_PRICE_PER_IMAGE : worstCaseCostUsd(req.model, shape);
}

function actualUsd(req: ResponsesRequest, usage: Usage): number {
  return isSam(req.model) ? Math.max(1, shapeOf(req).images) * SAM_PRICE_PER_IMAGE : tokenCostUsd(req.model, usage);
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = retryAfter === null ? NaN : Number(retryAfter) * 1000;
  const exp = 500 * 2 ** attempt;
  const jitter = Math.random() * exp * 0.5;
  return Number.isFinite(header) ? Math.max(header, exp) : exp + jitter;
}

export async function createResponse(req: ResponsesRequest, opts: CallOptions): Promise<CallResult> {
  const env = opts.env ?? readEnv();
  if (!env.META_API_KEY) throw new Error("META_API_KEY is not set");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((line) => console.info(JSON.stringify(line)));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 2;
  const maxRetryWaitMs = opts.maxRetryWaitMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const guard = opts.guard ?? spendGuardFor(env);

  const body = JSON.stringify({ store: false, ...req });
  const reservation = await guard.reserve(estimateUsd(req));
  const started = Date.now();
  let attempts = 0;
  let lastError: unknown;

  try {
    while (attempts <= maxRetries) {
      attempts += 1;
      let retryAfter: string | null = null;
      try {
        const res = await fetchImpl(`${env.META_API_BASE_URL}/responses`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.META_API_KEY}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          retryAfter = res.headers.get("retry-after");
          const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
          const e = parsed.success ? parsed.data.error : null;
          throw new MetaApiError(
            res.status,
            e?.type ?? null,
            e?.code ?? null,
            e?.message ?? `HTTP ${res.status}`,
            RETRYABLE_STATUS.has(res.status),
          );
        }
        const data = responseSchema.parse(await res.json());
        const usage: Usage = {
          input_tokens: data.usage?.input_tokens ?? 0,
          output_tokens: data.usage?.output_tokens ?? 0,
          cached_tokens: data.usage?.input_tokens_details?.cached_tokens ?? 0,
          reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        };
        const result: CallResult = {
          id: data.id,
          model: data.model ?? req.model,
          output: data.output,
          outputText: outputText(data.output),
          usage,
          costUsd: actualUsd(req, usage),
          latencyMs: Date.now() - started,
          attempts,
        };
        await reservation.settle(result.costUsd);
        log({
          event: "meta_call",
          task: opts.task,
          model: result.model,
          status: data.status,
          attempts,
          latency_ms: result.latencyMs,
          ...usage,
          cost_usd: Number(result.costUsd.toFixed(6)),
        });
        if (data.status === "incomplete") throw new MetaIncomplete(data.incomplete_details?.reason ?? null, result);
        if (data.status !== "completed")
          throw new MetaApiError(200, null, null, `Unexpected status ${data.status}`, false);
        return result;
      } catch (err) {
        if (err instanceof MetaIncomplete) throw err;
        lastError = err;
        const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
        const network = err instanceof TypeError; // fetch's network failure
        const retryable = err instanceof MetaApiError ? err.retryable : timedOut || network;
        if (!retryable || attempts > maxRetries) break;
        const wait = backoffMs(attempts - 1, retryAfter);
        if (wait > maxRetryWaitMs) break;
        await sleep(wait);
      }
    }
    // Nothing billable came back. A timed-out request may still be billed by
    // Meta, but there's no usage to record, so the reservation is released.
    await reservation.settle(0);
    log({
      event: "meta_call",
      task: opts.task,
      model: req.model,
      status: "failed",
      attempts,
      latency_ms: Date.now() - started,
      error_status: lastError instanceof MetaApiError ? lastError.status : null,
      error_type:
        lastError instanceof MetaApiError ? lastError.type : lastError instanceof Error ? lastError.name : null,
      error_code: lastError instanceof MetaApiError ? lastError.code : null,
    });
    throw lastError;
  } catch (err) {
    await reservation.settle(0);
    throw err;
  }
}
