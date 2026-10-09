import { useSyncExternalStore } from "react";

/** When the Activity tab was last looked at. The badge counts what happened
 * after it; opening History or the torrent list moves it forward. One store, so the shell's
 * badge and the list agree without prop-drilling. */
const KEY = "activity.lastSeen";
const listeners = new Set<() => void>();

function initial(): string {
  // a fresh install badges the last day, not everything the arrs remember
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}

export function getLastSeen(): string {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as string;
  } catch {
    // fall through to the default
  }
  const value = initial();
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // private mode: keep going without persistence
  }
  return value;
}

export function markSeen(iso: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(iso));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function useLastSeen(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLastSeen,
    getLastSeen,
  );
}

/** Whether a torrent finished after the visit's cutoff. Clients report
 * completion in unix seconds; unfinished torrents have none (or 0). */
export function finishedSince(completedOn: number | null | undefined, since: string): boolean {
  return completedOn != null && completedOn > 0 && completedOn * 1000 > Date.parse(since);
}
