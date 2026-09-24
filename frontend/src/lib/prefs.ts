// Display preferences: per device, in localStorage, readable from anywhere.
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
  return useSyncExternalStore(subscribe, () => readPref(key));
}
