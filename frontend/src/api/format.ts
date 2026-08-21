import type { WatchedItem } from "./types";

export const SERVICE_LABELS: Record<string, string> = {
  radarr: "Radarr",
  sonarr: "Sonarr",
  prowlarr: "Prowlarr",
  qbittorrent: "qBittorrent",
  transmission: "Transmission",
  overseerr: "Overseerr",
  gluetun: "gluetun",
  bazarr: "Bazarr",
  plex: "Plex",
  prometheus: "Prometheus",
};

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** "6h ago" / "in 12m". Intl handles the wording, so Danish needs no strings. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400_000],
    ["hour", 3600_000],
    ["minute", 60_000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(ms) >= size) return rtf.format(Math.round(ms / size), unit);
  }
  return rtf.format(Math.round(ms / 1000), "second");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatEpoch(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Whole days between today and `iso`, in local time. Compares day boundaries
 * rather than subtracting 24h, so a DST changeover (a 23- or 25-hour day) still
 * counts as one day. */
function dayOffset(iso: string): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(then) - midnight(new Date())) / 86_400_000);
}

/** Intl supplies the wording, so Danish gets "i dag" without a string of our
 * own. It comes back lowercase; these sit alone in a cell, so capitalise. */
function namedDay(offset: number): string {
  const named = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    offset,
    "day",
  );
  return named.charAt(0).toLocaleUpperCase() + named.slice(1);
}

/** Like formatDate, but says Today or Tomorrow when the date is one of them —
 * which on a dashboard is most of what anyone is looking for. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const offset = dayOffset(iso);
  if (offset === 0 || offset === 1) return namedDay(offset);
  return formatDate(iso);
}

/** formatDateTime with the same substitution, keeping the comma so a named day
 * and a dated one line up: "Today, 01:38 PM" against "Aug 18, 01:38 PM". */
export function formatDayTime(iso: string): string {
  const offset = dayOffset(iso);
  if (offset !== 0 && offset !== 1) return formatDateTime(iso);
  const time = new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${namedDay(offset)}, ${time}`;
}

/** Plex indexes watched state under every external id it knows; try each id the
 * arr holds until one hits. Undefined means Plex has never seen the title. */
export function watchedFor(
  map: Record<string, WatchedItem> | null | undefined,
  ids: { tmdb_id?: number | null; tvdb_id?: number | null; imdb_id?: string | null },
): WatchedItem | undefined {
  if (!map) return undefined;
  const keys = [
    ids.tmdb_id != null ? `tmdb:${ids.tmdb_id}` : null,
    ids.tvdb_id != null ? `tvdb:${ids.tvdb_id}` : null,
    ids.imdb_id ? `imdb:${ids.imdb_id}` : null,
  ];
  for (const key of keys) if (key && map[key]) return map[key];
  return undefined;
}
