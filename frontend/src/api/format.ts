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
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
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
