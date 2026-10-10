// Small pure helpers for the cleanup rules UI: dates, empty rules, and the
// wording of the server's reason codes.
import type { TFunction } from "i18next";
import { formatBytes } from "../api/format";
import type { CleanupConditions, CleanupReason, CleanupRuleDraft } from "../api/types";

const DAY = 86_400;

/** Whole days until a leaving title's date; 0 or less means "at the next run". */
export function daysLeft(leaveAt: number, nowMs = Date.now()): number {
  return Math.ceil((leaveAt - nowMs / 1000) / DAY);
}

/** The server matches nothing with a rule that has no condition; the editor
 * says so instead of showing an empty preview as if it were a result. */
export function hasConditions(c: CleanupConditions | undefined): boolean {
  if (!c) return false;
  return (
    c.watched_days != null ||
    c.unwatched_days != null ||
    c.min_size_gb != null ||
    c.rating_below != null ||
    !!c.unmonitored ||
    (c.with_tags?.length ?? 0) > 0 ||
    (c.without_tags?.length ?? 0) > 0
  );
}

/** A new rule: off, the default grace period, no conditions yet. */
export function newRule(kind: CleanupRuleDraft["kind"] = "movie"): CleanupRuleDraft {
  return { id: "", name: "", kind, enabled: false, grace_days: 14, conditions: {} };
}

export function reasonText(t: TFunction, reason: CleanupReason): string {
  const value = reason.value ?? 0;
  switch (reason.code) {
    case "watched":
    case "unwatched":
      return t(`cleanupRules.reason_${reason.code}`, { count: value });
    case "size":
      return formatBytes(value);
    case "rating":
      return t("cleanupRules.reason_rating", { value: value.toFixed(1) });
    default:
      return t(`cleanupRules.reason_${reason.code}`, reason.code);
  }
}
