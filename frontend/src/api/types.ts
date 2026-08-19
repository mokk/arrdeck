// Aliases over the generated OpenAPI types (src/api/generated, via
// @hey-api/openapi-ts). Regenerate with `npm run gen:api` after backend
// changes — drift then becomes a compile error instead of a runtime surprise.
import type * as G from "./generated";

export type ServiceStatus = G.ServiceStatus;
export type ServiceName = ServiceStatus["service"];
export type ServiceInfo = G.ServiceInfoOut;
export type ServiceSettings = G.ServiceSettingsOut;

/** Generic aggregate wrapper — the schema only has concrete instantiations,
 * so the generic form stays hand-written (shape-checked via the aliases below). */
export interface ServiceBlock<T> {
  ok: boolean;
  data?: T | null;
  error?: string | null;
  stale_age_seconds?: number | null;
}

export type Torrent = G.TorrentOut;
export type TorrentGroup = G.TorrentGroupOut;
export type TorrentDetails = G.TorrentDetailsOut;
export type QueueItem = G.QueueItemOut;
export type CalendarItem = G.CalendarItemOut;
export type HistoryItem = G.HistoryItemOut;
export type HistoryEvent = G.HistoryEventOut;
export type HistoryPage = G.HistoryPageOut;
export type IndexerStats = G.IndexerStatsOut;
export type SearchResult = G.SearchResultOut;
export type Release = G.ReleaseOut;
export type ArrRelease = G.ArrReleaseOut;
export type Options = G.OptionsOut;
export type Indexer = G.IndexerOut;
export type LibraryMovie = G.LibraryMovieOut;
export type LibrarySeries = G.LibrarySeriesOut;
export type SeriesDetail = G.SeriesDetailOut;
export type Season = G.SeasonOut;
export type Episode = G.EpisodeOut;
export type StatsSample = G.StatsSampleOut;
export type RecentItem = G.RecentItemOut;
export type WantedItem = G.WantedItemOut;
export type WantedPage = G.WantedPageOut;
export type Collection = G.CollectionOut;
export type CollectionDetail = G.CollectionDetailOut;
export type Tracker = G.TrackerOut;
export type SettingsExport = G.SettingsExportOut;
export type MovieDetail = G.MovieDetailOut;
export type TorrentSummary = G.TorrentSummaryOut;
export type Session = G.SessionOut;
export type DiskSpace = G.DiskSpaceOut;
export type HealthWarning = G.HealthWarningOut;
export type PushEvents = G.PushEventsOut;
export type WebhookApp = G.WebhookAppOut;
export type WebhookStatus = G.WebhookStatusOut;

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
