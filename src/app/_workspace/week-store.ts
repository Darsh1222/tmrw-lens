"use client";
import { useMemo, useSyncExternalStore } from "react";
import { readWeek, WEEK_KEY, type SavedWeek } from "@/lib/recovery/week";
import { NEXT_STEP_KEY, readNextTask } from "@/lib/recovery/next-step";
const EVENT = "lens:week-updated";
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};
const get = () => {
  try {
    return localStorage.getItem(WEEK_KEY);
  } catch {
    return null;
  }
};
export function currentWeek() {
  return readWeek(get());
}
export function updateWeek(fn: (week: SavedWeek) => SavedWeek) {
  const next = fn(currentWeek());
  localStorage.setItem(WEEK_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
  return next;
}
export function useSavedWeek() {
  const raw = useSyncExternalStore(subscribe, get, () => null);
  return useMemo(() => readWeek(raw), [raw]);
}
export function removeSavedTask(id: string) {
  updateWeek((w) => ({ ...w, tasks: w.tasks.filter((x) => x.task.id !== id) }));
  for (const storage of [sessionStorage, localStorage]) {
    const selected = readNextTask(storage.getItem(NEXT_STEP_KEY));
    if (selected?.id === id) storage.removeItem(NEXT_STEP_KEY);
  }
}
