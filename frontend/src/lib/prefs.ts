// Display preferences: per device, in localStorage, readable from anywhere.
// One store rather than scattered usePersistentState calls, because the same
// preference is changed in one place (the sort sheet, Settings → Display) and
// read in another (the grid), and both must update together.
import { useSyncExternalStore } from "react";
import type { LibraryKind } from "../api/types";

export type Layout = "posters" | "list" | "details";
export type Unmonitored = "show" | "dim" | "hide";

type Prefs = {
  [K in `layout.${LibraryKind}`]: Layout;
} & {
  [K in `unmonitored.${LibraryKind}`]: Unmonitored;
};

const DEFAULTS: Prefs = {
  "layout.movies": "posters",
  "layout.series": "posters",
  "layout.books": "posters",
  "unmonitored.movies": "show",
  "unmonitored.series": "show",
  "unmonitored.books": "show",
};

const PREFIX = "prefs.";
const listeners = new Set<() => void>();

function read<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw != null ? (JSON.parse(raw) as Prefs[K]) : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the choice lasts until reload */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // another tab changing a preference
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(subscribe, () => read(key));
}
