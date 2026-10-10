import { describe, expect, it } from "vitest";
import { daysLeft, hasConditions, newRule } from "./cleanupRules";

describe("cleanup rule helpers", () => {
  it("counts whole days left, rounding up, and reaches zero on the day", () => {
    const now = 1_800_000_000_000;
    expect(daysLeft(now / 1000 + 14 * 86_400, now)).toBe(14);
    expect(daysLeft(now / 1000 + 3600, now)).toBe(1);
    expect(daysLeft(now / 1000 - 10, now)).toBeLessThanOrEqual(0);
  });

  it("treats unset, false and empty as no condition, as the server does", () => {
    expect(hasConditions(undefined)).toBe(false);
    expect(hasConditions({ unmonitored: false, with_tags: [], watched_days: null })).toBe(
      false,
    );
    expect(hasConditions({ unmonitored: true })).toBe(true);
    expect(hasConditions({ without_tags: [3] })).toBe(true);
    expect(hasConditions({ min_size_gb: 50 })).toBe(true);
  });

  it("starts a new rule switched off with the default grace period", () => {
    expect(newRule("series")).toMatchObject({ kind: "series", enabled: false, grace_days: 14 });
  });
});
