"use client";

import { useSyncExternalStore } from "react";

// A value remembered in this browser (localStorage), read without a hydration mismatch: the server and the first
// render see null. Storage that's blocked or full just means it isn't remembered.

const listeners = new Set<() => void>();
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage.
  }
  listeners.forEach((f) => f());
}

export function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
}
