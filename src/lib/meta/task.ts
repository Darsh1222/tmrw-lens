import { z } from "zod";
import { readEnv } from "@/lib/env";
import {
  createResponse,
  type CallOptions,
  type CallResult,
  type ContentPart,
  type InputMessage,
  type ReasoningEffort,
} from "@/lib/meta/client";

// A small structured model call: a zod schema for the shape, a `check` for what a
// schema can't say, and one retry that tells the model what was wrong.

export type Task<T> = {
  name: string;
  /** Bump when the instructions change; it's logged with every call. */
  version: number;
  instructions: string;
  schema: z.ZodType<T>;
  check?: (out: T) => string | null;
  effort?: ReasoningEffort;
  maxOutputTokens?: number;
};

export type TaskResult<T> = { data: T; calls: CallResult[] };

export class TaskFailed extends Error {
  constructor(
    readonly task: string,
    readonly problem: string,
    readonly calls: CallResult[],
  ) {
    super(`${task}: ${problem}`);
    this.name = "TaskFailed";
  }
}

const SAFE_INT = Number.MAX_SAFE_INTEGER;

/**
 * Zod's JSON Schema made to fit Meta's strict subset: every object closed and
 * every property required (optional fields are modelled as nullable instead).
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" }) as Record<string, unknown>;
  delete json.$schema;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object" && n.properties && typeof n.properties === "object") {
      n.additionalProperties = false;
      n.required = Object.keys(n.properties);
    }
    // z.int() adds the safe-integer range, which is noise to the decoder.
    if (n.minimum === -SAFE_INT) delete n.minimum;
    if (n.maximum === SAFE_INT) delete n.maximum;
    Object.values(n).forEach(walk);
  };
  walk(json);
  return json;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** On a retry the effort goes up one step (never down): a failed check is a sign the task was harder than planned. */
const EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const escalate = (e: ReasoningEffort) => EFFORTS[Math.min(EFFORTS.indexOf(e) + 1, EFFORTS.length - 1)];

export async function runTask<T>(
  task: Task<T>,
  content: ContentPart[],
  opts: Omit<CallOptions, "task"> & { model?: string } = {},
): Promise<TaskResult<T>> {
  const env = opts.env ?? readEnv();
  const model = opts.model ?? env.MUSE_SPARK_MODEL;
  const format = {
    type: "json_schema" as const,
    name: task.name,
    schema: toStrictJsonSchema(task.schema),
    strict: true,
  };
  const calls: CallResult[] = [];
  const input: InputMessage[] = [{ role: "user", content }];
  let problem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await createResponse(
      {
        model,
        // Instructions go first and never change between calls of a task: that's the prefix the cache reuses.
        instructions: task.instructions,
        prompt_cache_key: task.name,
        input,
        text: { format },
        reasoning: { effort: attempt ? escalate(task.effort ?? "low") : (task.effort ?? "low") },
        max_output_tokens: task.maxOutputTokens ?? 8_000,
      },
      // ":retry" in the cost log is what the escalation rate is counted from.
      { ...opts, env, task: `${task.name}@v${task.version}${attempt ? ":retry" : ""}` },
    );
    calls.push(result);
    const parsed = task.schema.safeParse(parseJson(result.outputText));
    if (!parsed.success) {
      problem = `answer didn't match the schema: ${z.prettifyError(parsed.error)}`;
    } else {
      const checked = task.check?.(parsed.data) ?? null;
      if (checked === null) return { data: parsed.data, calls };
      problem = checked;
    }
    // One retry: show the model its answer and what's wrong with it.
    input.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Your previous answer was:\n${result.outputText}\n\nIt has a problem: ${problem}\nAnswer again, fixing only that.`,
        },
      ],
    });
  }
  throw new TaskFailed(task.name, problem, calls);
}
