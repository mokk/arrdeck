import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatDay,
  formatDayTime,
  formatEta,
  formatRelative,
  formatSpeed,
  watchedFor,
} from "./format";
import type { WatchedItem, WatchedMap } from "./types";

describe("formatBytes", () => {
  it("renders whole bytes without a decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("steps up through the units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1_635_113_074_688)).toBe("1.5 TB");
  });

  it("stops at TB rather than inventing a unit", () => {
    expect(formatBytes(1024 ** 6)).toMatch(/TB$/);
  });

  it("treats nothing as zero", () => {
    for (const value of [0, null, undefined]) {
      expect(formatBytes(value)).toBe("0 B");
    }
  });
});

describe("formatEta", () => {
  it("picks a unit that stays readable", () => {
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(90)).toBe("2m");
    expect(formatEta(3700)).toBe("1h 2m");
    expect(formatEta(200_000)).toBe("2d");
  });

  it("shows an em dash when there is no estimate", () => {
    expect(formatEta(null)).toBe("—");
    expect(formatEta(undefined)).toBe("—");
  });

  it("distinguishes 'no estimate' from zero", () => {
    expect(formatEta(0)).toBe("0s");
  });
});

describe("formatSpeed", () => {
  it("is bytes per second", () => {
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
  });
});

describe("watchedFor", () => {
  const seen: WatchedItem = { watched: true, progress: 1, key: "85" };
  const map: WatchedMap = {
    base_url: "https://app.plex.tv/desktop/#!/server/abc/details?key=/library/metadata/",
    items: { "tmdb:170": seen, "tvdb:871": seen },
  };

  it("matches a movie on its tmdb id", () => {
    expect(watchedFor(map, { tmdb_id: 170 })?.watched).toBe(true);
  });

  it("matches a series on its tvdb id", () => {
    expect(watchedFor(map, { tvdb_id: 871 })?.watched).toBe(true);
  });

  it("falls through the ids in order until one hits", () => {
    // radarr holds a tmdb id plex doesn't know, but the imdb id lines up
    const withImdb = { ...map, items: { ...map.items, "imdb:tt0289043": seen } };
    expect(watchedFor(withImdb, { tmdb_id: 999999, imdb_id: "tt0289043" })?.watched).toBe(true);
  });

  it("composes the Plex link from the shared prefix and the entry key", () => {
    // The prefix ships once rather than per entry — it was two thirds of a
    // 98 KB payload — so the join has to happen here or the link breaks.
    expect(watchedFor(map, { tmdb_id: 170 })?.url).toBe(
      "https://app.plex.tv/desktop/#!/server/abc/details?key=/library/metadata/85",
    );
  });

  it("leaves the link undefined when Plex gave no server id", () => {
    const noServer: WatchedMap = { base_url: null, items: map.items };
    const item = watchedFor(noServer, { tmdb_id: 170 });
    expect(item?.watched).toBe(true);
    expect(item?.url).toBeUndefined();
  });

  it("leaves the link undefined for an entry with no key", () => {
    const noKey: WatchedMap = {
      base_url: map.base_url,
      items: { "tmdb:170": { watched: false, progress: 0 } },
    };
    expect(watchedFor(noKey, { tmdb_id: 170 })?.url).toBeUndefined();
  });

  it("is undefined when plex has never seen the title", () => {
    expect(watchedFor(map, { tmdb_id: 999999 })).toBeUndefined();
  });

  it("ignores ids the arr doesn't have rather than matching a stray key", () => {
    // a null id must not become the string "tmdb:null" and collide
    const stray: WatchedMap = { base_url: null, items: { "tmdb:null": seen } };
    expect(watchedFor(stray, { tmdb_id: null })).toBeUndefined();
  });

  it("tolerates a missing map, which is what an unconfigured plex looks like", () => {
    expect(watchedFor(undefined, { tmdb_id: 170 })).toBeUndefined();
    expect(watchedFor(null, { tmdb_id: 170 })).toBeUndefined();
  });
});

describe("formatRelative", () => {
  // The tasks card reads "last ran" and "next run" off this, so a wrong sign
  // would say a task is due when it is actually late.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("distinguishes past from future", () => {
    expect(formatRelative("2026-08-20T06:00:00Z")).toBe("6 hours ago");
    expect(formatRelative("2026-08-20T18:00:00Z")).toBe("in 6 hours");
  });

  it("picks the largest unit that fits", () => {
    expect(formatRelative("2026-08-18T12:00:00Z")).toBe("2 days ago");
    expect(formatRelative("2026-08-20T11:30:00Z")).toBe("30 minutes ago");
    expect(formatRelative("2026-08-20T11:59:50Z")).toBe("10 seconds ago");
  });

  it("reads a missing or unparseable time as unknown", () => {
    expect(formatRelative(null)).toBe("—");
    expect(formatRelative(undefined)).toBe("—");
    expect(formatRelative("")).toBe("—");
    expect(formatRelative("not a date")).toBe("—");
  });
});

describe("formatDay", () => {
  // Local time throughout: the dashboard is read on a phone in the user's zone,
  // and "Tomorrow" has to mean their tomorrow.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 14, 0, 0)); // 20 Aug 2026, local
  });
  afterEach(() => vi.useRealTimers());

  const local = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it("names today and tomorrow", () => {
    expect(formatDay(local(2026, 7, 20))).toBe("Today");
    expect(formatDay(local(2026, 7, 21))).toBe("Tomorrow");
  });

  it("names them from the edges of the day, not a 24h window", () => {
    expect(formatDay(local(2026, 7, 20, 0))).toBe("Today");
    expect(formatDay(local(2026, 7, 20, 23))).toBe("Today");
    // 23:00 tomorrow is 33h away, but it is still tomorrow
    expect(formatDay(local(2026, 7, 21, 23))).toBe("Tomorrow");
  });

  it("falls back to a date outside that window", () => {
    expect(formatDay(local(2026, 7, 22))).toBe("Aug 22");
    expect(formatDay(local(2026, 7, 19))).toBe("Aug 19");
  });

  it("treats nothing as unknown rather than as today", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay(undefined)).toBe("—");
    expect(formatDay("")).toBe("—");
    expect(formatDay("not a date")).toBe("Invalid Date");
  });
});

describe("formatDayTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 14, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the time and swaps only the date part", () => {
    const today = formatDayTime(new Date(2026, 7, 20, 13, 38).toISOString());
    expect(today).toMatch(/^Today, /);
    expect(today).toMatch(/38/);
  });

  it("leaves other days as they were", () => {
    expect(formatDayTime(new Date(2026, 7, 18, 13, 38).toISOString())).toMatch(/^Aug 18/);
  });
});
