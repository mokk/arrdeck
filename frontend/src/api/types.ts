// Aliases into the generated OpenAPI schema (src/api/schema.d.ts).
// Regenerate with `npm run gen:api` after backend changes — drift then
// becomes a compile error instead of a runtime surprise.
import type { components } from "./schema";

type S = components["schemas"];

export type ServiceStatus = S["ServiceStatus"];
export type ServiceName = ServiceStatus["service"];
export type ServiceInfo = S["ServiceInfoOut"];
export type ServiceSettings = S["ServiceSettingsOut"];

/** Generic aggregate wrapper — the schema only has concrete instantiations,
 * so the generic form stays hand-written (shape-checked via the aliases below). */
export interface ServiceBlock<T> {
  ok: boolean;
  data?: T | null;
  error?: string | null;
  stale_age_seconds?: number | null;
}

export type Torrent = S["TorrentOut"];
export type TorrentGroup = S["TorrentGroupOut"];
export type TorrentDetails = S["TorrentDetailsOut"];
export type QueueItem = S["QueueItemOut"];
export type CalendarItem = S["CalendarItemOut"];
export type HistoryItem = S["HistoryItemOut"];
export type HistoryEvent = S["HistoryEventOut"];
export type HistoryPage = S["HistoryPageOut"];
export type IndexerStats = S["IndexerStatsOut"];
export type SearchResult = S["SearchResultOut"];
export type Release = S["ReleaseOut"];
export type ArrRelease = S["ArrReleaseOut"];
export type Options = S["OptionsOut"];
export type Indexer = S["IndexerOut"];
export type LibraryMovie = S["LibraryMovieOut"];
export type LibrarySeries = S["LibrarySeriesOut"];
export type SeriesDetail = S["SeriesDetailOut"];
export type Season = S["SeasonOut"];
export type Episode = S["EpisodeOut"];
export type StatsSample = S["StatsSampleOut"];

// /indexers/schemas returns untyped dicts server-side; hand-written for now.
export interface IndexerSchemaField {
  name: string;
  label: string;
  type: string;
  value: unknown;
  help_text: string | null;
  select_options: { value: unknown; name: string }[];
}

export interface IndexerSchema {
  name: string;
  protocol: string | null;
  privacy: string | null;
  description: string | null;
  fields: IndexerSchemaField[];
}
