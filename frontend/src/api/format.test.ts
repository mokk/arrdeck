import { describe, expect, it } from "vitest";
import { formatBytes, formatEta, formatSpeed } from "./format";

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
