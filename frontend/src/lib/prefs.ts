// Display preferences: in localStorage, readable from anywhere, and shared with
// the server (lib/prefsSync.ts) so they follow you between devices.
// One store rather than scattered usePersistentState calls, because the same
// preference is changed in one place (the sort sheet, Settings → Display) and
// read in another (the grid), and both must update together.
import { useSyncExternalStore } from "react";
import type { LibraryKind } from "../api/types";

export type Layout =
  | "posters"
  | "list"
  | "details"
  | "upnext"
  | "seasons"
  | "shelf"
  | "collections";

/** Each tab's views: the three shared layouts, then the one that only makes
 * sense for that kind — airing order for shows, series for books, Radarr's
 * collections for films. */
export const LAYOUTS_FOR: Record<LibraryKind, Layout[]> = {
  movies: ["posters", "list", "details", "collections"],
  series: ["posters", "list", "details", "upnext", "seasons"],
  books: ["posters", "list", "details", "shelf"],
};
export type Unmonitored = "show" | "dim" | "hide";
/** Dates as "3 days ago" or "Sep 20". */
export type DateStyle = "relative" | "absolute";
/** 1 GB as 1024 MB (what arrdeck always showed) or 1000 MB, as disks are sold. */
export type SizeStyle = "binary" | "decimal";
/** Hide what unwatched episodes are about: never, until watched, or always. */
export type Spoilers = "off" | "unwatched" | "always";
/** Which actions ask first. Deleting a title always asks whether to keep the
 * files, since that is a choice rather than a confirmation. */
export type ConfirmPolicy = "always" | "deletes" | "never";

type Prefs = {
  [K in `layout.${LibraryKind}`]: Layout;
} & {
  [K in `unmonitored.${LibraryKind}`]: Unmonitored;
} & {
  /** a tab's route, or "" for the first tab */
  startTab: string;
  tabOrder: string[];
  hiddenTabs: string[];
  dates: DateStyle;
  sizes: SizeStyle;
  spoilers: Spoilers;
  confirm: ConfirmPolicy;
};

const DEFAULTS: Prefs = {
  startTab: "",
  tabOrder: [],
  hiddenTabs: [],
  dates: "relative",
  sizes: "binary",
  spoilers: "off",
  confirm: "deletes",
  "layout.movies": "posters",
  "layout.series": "posters",
  "layout.books": "posters",
  "unmonitored.movies": "show",
  "unmonitored.series": "show",
  "unmonitored.books": "show",
};

const PREFIX = "prefs.";
const listeners = new Set<() => void>();
// Told only when the user changes something, not when synced values land — the
// sync would otherwise push back what it just pulled.
const changeListeners = new Set<() => void>();

/** Every synced preference, by the name it has on the wire and in storage. */
export const PREF_KEYS = Object.keys(DEFAULTS) as (keyof Prefs)[];

const LAYOUTS: Layout[] = Object.values(LAYOUTS_FOR).flat();
const OPTIONS: Record<string, readonly string[]> = {
  unmonitored: ["show", "dim", "hide"],
  dates: ["relative", "absolute"],
  sizes: ["binary", "decimal"],
  spoilers: ["off", "unwatched", "always"],
  confirm: ["always", "deletes", "never"],
};

/** Whether a value from another client is one this build can show. Another
 * client may be newer, and a layout or option it has that this one does not
 * must not reach the UI. */
function isValidPref(key: string, value: unknown): boolean {
  if (key === "tabOrder" || key === "hiddenTabs") {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
  if (key === "startTab") return typeof value === "string";
  if (key.startsWith("layout.")) return LAYOUTS.includes(value as Layout);
  const options = OPTIONS[key.startsWith("unmonitored.") ? "unmonitored" : key];
  return !!options && options.includes(value as string);
}

// Parsed values are cached per raw string: useSyncExternalStore compares
// snapshots by identity, and an array preference parsed afresh on every read
// would look changed every time.
const parsed = new Map<string, unknown>();

/** A preference outside React — the formatters read sizes and dates this way. */
export function readPref<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return DEFAULTS[key];
    if (!parsed.has(raw)) parsed.set(raw, JSON.parse(raw));
    return parsed.get(raw) as Prefs[K];
  } catch {
    return DEFAULTS[key];
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  const next = JSON.stringify(value);
  let changed = true;
  try {
    changed = localStorage.getItem(PREFIX + key) !== next;
    localStorage.setItem(PREFIX + key, next);
  } catch {
    /* storage unavailable — the choice lasts until reload */
  }
  for (const fn of listeners) fn();
  if (changed) for (const fn of changeListeners) fn();
}

/** Writes values that arrived from the server. Keys the server did not send are
 * left alone. */
export function storePrefs(values: Record<string, unknown>): void {
  for (const key of PREF_KEYS) {
    if (!(key in values) || !isValidPref(key, values[key])) continue;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(values[key]));
    } catch {
      /* storage unavailable */
    }
  }
  for (const fn of listeners) fn();
}

/** Whether this device holds any choice of its own, as opposed to defaults. */
export function hasStoredPrefs(): boolean {
  try {
    return PREF_KEYS.some((key) => localStorage.getItem(PREFIX + key) != null);
  } catch {
    return false;
  }
}

/** For the sync: a change the user just made. */
export function onPrefChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
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
  return useSyncExternalStore(subscribe, () => readPref(key));
}
