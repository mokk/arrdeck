import type {
  PlaySession,
  QueueItem,
  ServiceBlock,
  TorrentGroup,
  TorrentSummary,
} from "../api/types";

// Poll cadences shared by every hook module.
export const FAST = 5_000;
export const MEDIUM = 30_000;
export const SLOW = 300_000;

// What a live view falls back to once its numbers stop changing. FAST exists for
// progress bars; a stack that is only seeding has none, and the foreground poll
// is where an open tab spends its battery. 20s rather than MEDIUM because these
// are views the user is looking at while it applies.
export const IDLE = 20_000;

// Progress is advancing in these states and nowhere else. `stalled` is a download
// that has stopped moving, and `seeding` is a steady rate that only wiggles —
// both read fine at the idle cadence.
const MOVING_STATES = new Set(["downloading", "checking"]);

/** True while some transfer's numbers are still changing. */
export function torrentsMoving(cache: TorrentsCache | undefined): boolean {
  if (!cache) return false;
  return Object.values(cache).some((block) => {
    const group = block?.data;
    if (!group) return false;
    if ((group.totals?.dl_speed ?? 0) > 0) return true;
    return (group.states ?? []).some((state) => MOVING_STATES.has(state));
  });
}

/** The summary card ships only the top few active torrents, so judge those. */
export function summaryMoving(
  cache: Record<string, ServiceBlock<TorrentSummary>> | undefined,
): boolean {
  if (!cache) return false;
  return Object.values(cache).some((block) => {
    const summary = block?.data;
    if (!summary) return false;
    if ((summary.totals?.dl_speed ?? 0) > 0) return true;
    return (summary.active ?? []).some((torrent) => MOVING_STATES.has(torrent.state));
  });
}

/** An arr queue item still has bytes to fetch. An empty or fully-grabbed queue
 * is not going to change on its own. */
export function queueMoving(
  cache: Record<string, ServiceBlock<QueueItem[]>> | undefined,
): boolean {
  if (!cache) return false;
  return Object.values(cache).some((block) =>
    (block?.data ?? []).some((item) => (item.size_left ?? 0) > 0),
  );
}

/** A paused session's progress bar is not going anywhere. */
export function sessionsMoving(block: ServiceBlock<PlaySession[]> | undefined): boolean {
  return (block?.data ?? []).some((session) => session.state === "playing");
}

export type TorrentsCache = {
  qbittorrent: ServiceBlock<TorrentGroup>;
  transmission: ServiceBlock<TorrentGroup>;
};
