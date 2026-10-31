import { center, iou, pointInPolygon, polygonArea } from "@/lib/images/geometry";
import type { SceneObject } from "@/lib/plan/types";
import type { BBox, Region } from "@/lib/schemas/evidence";

// Which SAM object a quote belongs to. Pure code on the boxes the model gave
// and the outlines SAM gave, so it reruns the same on recorded readings.

/** Lower is more specific: a sticky note on a whiteboard is the sticky note. */
const SPECIFIC = { sticky_note: 0, paper: 1, whiteboard: 2 } as const;

/**
 * One object per physical thing: "paper" and "sticky note" often find the same note (and a notebook page). The
 * likelier label wins; when they're within 0.05, the more specific one.
 */
export function dedupeObjects(objects: SceneObject[]): SceneObject[] {
  const conf = (o: SceneObject) => Math.round((o.confidence ?? 1) * 20) / 20;
  const sorted = [...objects].sort((a, b) => conf(b) - conf(a) || SPECIFIC[a.label] - SPECIFIC[b.label]);
  const kept: SceneObject[] = [];
  for (const o of sorted) if (!kept.some((k) => iou(k.bbox, o.bbox) > 0.8)) kept.push(o);
  return kept;
}

/** The smallest object whose outline holds the centre of the quote's box. `objects` is SAM's raw detections. */
export function objectFor(bbox: BBox | null, objects: SceneObject[] | undefined): SceneObject | null {
  if (!bbox || !objects?.length) return null;
  const c = center(bbox);
  const hits = dedupeObjects(objects).filter((o) => pointInPolygon(c, o.outline));
  return hits.sort((a, b) => polygonArea(a.outline) - polygonArea(b.outline))[0] ?? null;
}

export function regionOf(o: SceneObject): Region {
  return { object_id: o.id, label: o.label, outline: o.outline };
}
