import { describe, expect, it } from "vitest";
import { forecastFull } from "./forecast";

const day = 86_400;
const series = (free: (i: number) => number, count = 30) =>
  Array.from({ length: count }, (_, i) => ({
    ts: 1_790_000_000 + i * day,
    disk_free_bytes: free(i),
  }));

describe("forecastFull", () => {
  it("projects a steady loss to the day the disk is empty", () => {
    const f = forecastFull(series((i) => 1000e9 - i * 10e9));
    expect(f.kind).toBe("full");
    if (f.kind === "full") {
      expect(Math.round(f.perDay / 1e9)).toBe(10);
      expect(Math.round(f.days)).toBe(71); // 710 GB left at 10 GB a day
    }
  });

  it("has no date when free space holds or grows", () => {
    expect(forecastFull(series(() => 500e9)).kind).toBe("steady");
    expect(forecastFull(series((i) => 500e9 + i * 1e9)).kind).toBe("steady");
  });

  it("says nothing on too little history", () => {
    expect(forecastFull(series((i) => 1000e9 - i * 10e9, 5)).kind).toBe("unknown");
  });
});
