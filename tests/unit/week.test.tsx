import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rowsFor } from "@/app/_lens/plan/model";
import { DayTimeline } from "@/app/_lens/rebuild/DayTimeline";
import { buildWeek, hoursInto, placeOf, span, twelveHour, yOf } from "@/app/_lens/rebuild/week";
import { WeekGrid } from "@/app/_lens/rebuild/WeekGrid";
import REBUILDS from "@/lib/demo/rebuilds.json";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";

const cases = REBUILDS.map((r) => ({
  name: r.name,
  req: RebuildRequest.parse(r.request),
  res: RebuildResponse.parse(r.response),
}));
const iso = (s: string) => new Date(s).toISOString();
const attr = (start: string, end?: string) => `data-start="${iso(start)}"${end ? ` data-end="${iso(end)}"` : ""}`;

describe("the week after the rebuild", () => {
  it.each(cases)(
    "$name: every move's new time is in the rendered week, and its old slot is a ghost",
    ({ req, res }) => {
      const model = buildWeek(req, res);
      const grid = renderToStaticMarkup(
        <WeekGrid model={model} phase="after" missedId={req.missed.item_id} showBands={false} badge={false} reduced />,
      );
      const phone = renderToStaticMarkup(<DayTimeline model={model} phase="after" missedId={req.missed.item_id} />);
      for (const x of res.diff) {
        const item = req.items.find((i) => i.id === x.item_id)!;
        if (x.action === "move") {
          const block = model.after.find((b) => b.id === x.item_id && b.kind === "session")!;
          expect(block.start).toBe(Date.parse(x.start!));
          expect(block.end).toBe(Date.parse(x.end!));
          expect(grid).toContain(`data-item="${x.item_id}" data-kind="session" data-day="${block.day}" ${attr(x.start!, x.end!)}`); // prettier-ignore
          expect(phone).toContain(`data-item="${x.item_id}" data-kind="session" ${attr(x.start!)}`);
        }
        if (x.action !== "keep") {
          expect(grid).toContain(`data-item="${x.item_id}" data-kind="ghost"`);
          expect(grid).toContain(attr(item.start, item.end));
          // Never drawn at the old time as if nothing happened.
          expect(grid).not.toContain(`data-item="${x.item_id}" data-kind="session" data-day="${model.after.find((b) => b.key === `ghost-${x.item_id}`)!.day}" ${attr(item.start, item.end)}`); // prettier-ignore
        } else if (item.status === "planned") {
          expect(grid).toContain(`data-item="${x.item_id}" data-kind="session"`);
        }
      }
    },
  );

  it("counts the whole week: every item, class, and deadline", () => {
    const { req, res } = cases.find((c) => c.name === "tired-tonight")!;
    expect(buildWeek(req, res).counts).toEqual({ changed: 1, unchanged: 7, total: 8 });
  });

  it("draws a moved block at the pixel where its time is on the axis", () => {
    const { req, res } = cases.find((c) => c.name === "tired-tonight")!;
    const model = buildWeek(req, res);
    const move = model.moves[0];
    const p = placeOf(model, move.to.day, move.to.start, move.to.end);
    expect(p.col).toBe(1); // Thursday
    expect(p.top).toBe(yOf(model.rows, 7.5));
  });

  it("keeps the clock-change day aligned with its hour labels", () => {
    const { req, res } = cases.find((c) => c.name === "dst-weekend")!;
    const model = buildWeek(req, res);
    const move = model.moves[0];
    expect(hoursInto(move.to.start, move.to.day, model.zone)).toBe(10); // 10 AM Sunday, after clocks fell back
    const row = model.rows.find((r) => r.from === 10)!;
    expect(row.label).toBe("10 AM");
  });
});

describe("times", () => {
  it("are 12-hour US times, never 24-hour", () => {
    const z = "America/New_York";
    expect(span(Date.parse("2026-11-04T16:00:00-05:00"), Date.parse("2026-11-04T17:00:00-05:00"), z)).toBe("4–5 PM");
    expect(span(Date.parse("2026-11-05T07:30:00-05:00"), Date.parse("2026-11-05T08:30:00-05:00"), z)).toBe(
      "7:30–8:30 AM",
    );
    expect(span(Date.parse("2026-11-05T11:00:00-05:00"), Date.parse("2026-11-05T12:15:00-05:00"), z)).toBe(
      "11 AM–12:15 PM",
    );
    expect(twelveHour("It has to finish by Thu Nov 5 10:00 (Quiz 3); free 19:00-22:00")).toBe(
      "It has to finish by Thu Nov 5 10 AM (Quiz 3); free 7 PM-10 PM",
    );
  });

  it("compress hours with nothing in them", () => {
    const { req, res } = cases.find((c) => c.name === "tired-tonight")!;
    const model = buildWeek(req, res);
    expect(model.rows[0].from).toBe(7);
    expect(model.rows.at(-1)!.to).toBe(24);
    expect(model.rows.some((r) => r.label === null)).toBe(true);
    expect(model.rows.every((r) => r.label === null || /^\d{1,2} (AM|PM)$/.test(r.label))).toBe(true);
  });
});

describe("the results week's hour axis", () => {
  it("ends at midnight: an 11:59 PM deadline opens no 12 AM row", () => {
    const e = { start: 23 + 59 / 60, end: null } as Parameters<typeof rowsFor>[0][number];
    const rows = rowsFor([e]);
    expect(rows.at(-1)).toMatchObject({ from: 23, to: 24, label: "11 PM" });
  });
});
