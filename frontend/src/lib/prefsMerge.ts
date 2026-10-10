/** What to do about a server copy of the display preferences and the local one.
 * Pure, so the rule is testable without a network or a clock. */
type SyncAction = "apply" | "push" | "none";

type SyncFacts = {
  /** the server's updated_at; 0 when nothing was ever stored there */
  serverAt: number;
  /** the server's updated_at at the last sync this device completed; 0 = never */
  syncedAt: number;
  /** when the oldest unsent local change was made; 0 = nothing waiting */
  changedAt: number;
  /** whether this device has choices of its own rather than defaults */
  hasLocalValues: boolean;
};

export function decideSync({
  serverAt,
  syncedAt,
  changedAt,
  hasLocalValues,
}: SyncFacts): SyncAction {
  // Unsent changes: last write wins, whoever made it. A change made offline
  // earlier than one the server has since received loses.
  if (changedAt > 0) return serverAt > changedAt ? "apply" : "push";
  if (serverAt > syncedAt) return "apply";
  // Nothing waiting and the server has nothing newer. It may still have nothing
  // at all, or have been restored from an older backup; if this device holds
  // choices, they are the copy worth keeping.
  if (hasLocalValues && (serverAt === 0 || serverAt < syncedAt)) return "push";
  return "none";
}
