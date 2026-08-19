import { describe, expect, it } from "vitest";
import { formatBytes, formatEta, formatSpeed, watchedFor } from "./format";
import type { WatchedItem } from "./types";

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
  const seen: WatchedItem = { watched: true, progress: 1, url: "/plex" };
  const map: Record<string, WatchedItem> = { "tmdb:170": seen, "tvdb:871": seen };

  it("matches a movie on its tmdb id", () => {
    expect(watchedFor(map, { tmdb_id: 170 })).toBe(seen);
  });

  it("matches a series on its tvdb id", () => {
    expect(watchedFor(map, { tvdb_id: 871 })).toBe(seen);
  });

  it("falls through the ids in order until one hits", () => {
    // radarr holds a tmdb id plex doesn't know, but the imdb id lines up
    const withImdb = { ...map, "imdb:tt0289043": seen };
    expect(watchedFor(withImdb, { tmdb_id: 999999, imdb_id: "tt0289043" })).toBe(seen);
  });

  it("is undefined when plex has never seen the title", () => {
    expect(watchedFor(map, { tmdb_id: 999999 })).toBeUndefined();
  });

  it("ignores ids the arr doesn't have rather than matching a stray key", () => {
    // a null id must not become the string "tmdb:null" and collide
    expect(watchedFor({ "tmdb:null": seen }, { tmdb_id: null })).toBeUndefined();
  });

  it("tolerates a missing map, which is what an unconfigured plex looks like", () => {
    expect(watchedFor(undefined, { tmdb_id: 170 })).toBeUndefined();
    expect(watchedFor(null, { tmdb_id: 170 })).toBeUndefined();
  });
});
