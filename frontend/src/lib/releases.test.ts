import { describe, expect, it } from "vitest";
import type { ArrRelease } from "../api/types";
import {
  distinctValues,
  filterReleases,
  filtersActive,
  NO_FILTERS,
  sortReleases,
} from "./releases";

const rel = (over: Partial<ArrRelease>): ArrRelease => ({
  guid: over.title ?? "g",
  indexer_id: 1,
  title: "t",
  approved: true,
  ...over,
});

const rows = [
  rel({
    title: "A.2160p.REMUX-FraMeSToR",
    quality: "Remux-2160p",
    release_group: "FraMeSToR",
    size: 60e9,
    seeders: 5,
    age_days: 30,
    custom_format_score: 500,
  }),
  rel({
    title: "B.1080p.WEB-DL-NTb",
    quality: "WEBDL-1080p",
    release_group: "NTb",
    size: 4e9,
    seeders: 90,
    age_days: 2,
    custom_format_score: 100,
  }),
  rel({
    title: "C.1080p.WEB-DL-GRP",
    quality: "WEBDL-1080p",
    release_group: "GRP",
    size: 8e9,
    seeders: 20,
    age_days: 400,
  }),
  rel({
    title: "D.720p.HDTV",
    quality: "HDTV-720p",
    size: 2e9,
    seeders: 300,
    age_days: 1,
    approved: false,
    custom_format_score: 9999,
  }),
];

const titles = (rs: ArrRelease[]) => rs.map((r) => r.title[0]).join("");

describe("sortReleases", () => {
  it("keeps the server's order for 'best'", () => {
    expect(titles(sortReleases(rows, "best"))).toBe("ABCD");
  });

  it("sorts by custom format score, a missing score counting as zero", () => {
    expect(titles(sortReleases(rows, "score"))).toBe("ABCD");
    expect(titles(sortReleases([rows[2], rows[1]], "score"))).toBe("BC");
  });

  it("sorts by size, seeders and age, newest first", () => {
    expect(titles(sortReleases(rows, "size"))).toBe("ACBD");
    expect(titles(sortReleases(rows, "seeders"))).toBe("BCAD");
    expect(titles(sortReleases(rows, "age"))).toBe("BACD");
  });

  it("sinks rejected releases below approved ones under every sort", () => {
    for (const sort of ["score", "size", "seeders", "age"] as const) {
      expect(titles(sortReleases(rows, sort)).endsWith("D")).toBe(true);
    }
  });

  it("puts releases with no age or seeders last", () => {
    const gaps = [rel({ title: "X" }), rel({ title: "Y", age_days: 3, seeders: 1 })];
    expect(titles(sortReleases(gaps, "age"))).toBe("YX");
    expect(titles(sortReleases(gaps, "seeders"))).toBe("YX");
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortReleases(rows, "size");
    expect(rows).toEqual(copy);
  });
});

describe("filterReleases", () => {
  it("passes everything with no filters", () => {
    expect(filterReleases(rows, NO_FILTERS)).toHaveLength(4);
  });

  it("matches every typed word against the title, in any order and case", () => {
    expect(titles(filterReleases(rows, { ...NO_FILTERS, text: "web 1080P" }))).toBe("BC");
    expect(filterReleases(rows, { ...NO_FILTERS, text: "web remux" })).toHaveLength(0);
  });

  it("filters on quality, group and approval", () => {
    expect(titles(filterReleases(rows, { ...NO_FILTERS, quality: "WEBDL-1080p" }))).toBe("BC");
    expect(titles(filterReleases(rows, { ...NO_FILTERS, group: "NTb" }))).toBe("B");
    expect(titles(filterReleases(rows, { ...NO_FILTERS, approvedOnly: true }))).toBe("ABC");
  });

  it("filters on a size range, either end optional", () => {
    expect(titles(filterReleases(rows, { ...NO_FILTERS, minBytes: 5e9 }))).toBe("AC");
    expect(titles(filterReleases(rows, { ...NO_FILTERS, maxBytes: 5e9 }))).toBe("BD");
    expect(titles(filterReleases(rows, { ...NO_FILTERS, minBytes: 3e9, maxBytes: 10e9 }))).toBe(
      "BC",
    );
  });
});

describe("helpers", () => {
  it("lists the distinct values present, sorted, without blanks", () => {
    expect(distinctValues(rows, (r) => r.release_group)).toEqual(["FraMeSToR", "GRP", "NTb"]);
    expect(distinctValues(rows, (r) => r.quality)).toEqual([
      "HDTV-720p",
      "Remux-2160p",
      "WEBDL-1080p",
    ]);
  });

  it("knows when a filter is set", () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, approvedOnly: true })).toBe(true);
    expect(filtersActive({ ...NO_FILTERS, maxBytes: 0 })).toBe(true);
  });
});
