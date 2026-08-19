// Movies, series, episodes, discovery, calendar and history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  PopularSnapshot,
  ArrRelease,
  MovieDetail,
  CalendarItem,
  Collection,
  CollectionDetail,
  Episode,
  HistoryItem,
  HistoryPage,
  RecentItem,
  SeriesDetail,
  MediaRequest,
  Tag,
  StatsSample,
  WantedPage,
  Indexer,
  IndexerSchema,
  IndexerStats,
  LibraryMovie,
  LibrarySeries,
  Options,
  Release,
  SearchResult,
  ServiceBlock,
  TorrentGroup,
} from "../api/types";
import { MEDIUM, SLOW } from "./shared";

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/auth/credentials/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

export const useRecent = () =>
  useQuery({
    queryKey: ["recent"],
    queryFn: () => api.get<RecentItem[]>("/dashboard/recent"),
    refetchInterval: 60_000,
  });

export const useWanted = (app: "radarr" | "sonarr", kind: "missing" | "cutoff", page: number) =>
  useQuery({
    queryKey: ["wanted", app, kind, page],
    queryFn: () => api.get<WantedPage>(`/wanted/${app}?kind=${kind}&page=${page}`),
    staleTime: 60_000,
  });

export function useWantedSearchAll() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, kind }: { app: "radarr" | "sonarr"; kind: string }) =>
      api.post<void>(`/wanted/${app}/search-all?kind=${kind}`),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

export const useCollectionDetail = (id: number | null) =>
  useQuery({
    queryKey: ["collectionDetail", id],
    queryFn: () => api.get<CollectionDetail>(`/collections/${id}`),
    enabled: id != null,
    staleTime: 60_000,
  });

export const useCollections = (enabled: boolean) =>
  useQuery({
    queryKey: ["collections"],
    queryFn: () => api.get<Collection[]>("/collections"),
    enabled,
    staleTime: 300_000,
  });

export function useToggleCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, monitored }: { id: number; monitored: boolean }) =>
      api.patch<void>(`/collections/${id}?monitored=${monitored}`),
    onMutate: async ({ id, monitored }) => {
      await qc.cancelQueries({ queryKey: ["collections"] });
      const prev = qc.getQueryData<Collection[]>(["collections"]);
      qc.setQueryData<Collection[]>(["collections"], (old) =>
        old?.map((c) => (c.id === id ? { ...c, monitored } : c)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["collections"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export const useTags = (app: "radarr" | "sonarr", enabled = true) =>
  useQuery({
    queryKey: ["tags", app],
    queryFn: () => api.get<Tag[]>(`/tags/${app}`),
    enabled,
    staleTime: SLOW,
  });

export function useBulkLibrary(kind: "movies" | "series") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      ids: number[];
      monitored?: boolean;
      quality_profile_id?: number;
      tags?: number[];
      apply_tags?: "add" | "remove" | "replace";
    }) =>
      api.post<void>(`/library/${kind}/bulk`, input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useBulkDeleteLibrary(kind: "movies" | "series") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; delete_files: boolean }) =>
      api.post<void>(`/library/${kind}/bulk-delete`, input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useBulkSearchLibrary(kind: "movies" | "series") {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api.post<void>(`/library/${kind}/bulk-search`, { ids, delete_files: false }),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

export const useCalendarRange = (startDate: string, days: number) =>
  useQuery({
    queryKey: ["calendarRange", startDate, days],
    queryFn: () =>
      api.get<{ radarr: ServiceBlock<CalendarItem[]>; sonarr: ServiceBlock<CalendarItem[]> }>(
        `/calendar?days=${days}&start_date=${startDate}`,
      ),
    staleTime: 300_000,
  });

export const useMovieDetail = (id: number) =>
  useQuery({
    queryKey: ["movieDetail", id],
    queryFn: () => api.get<MovieDetail>(`/library/movies/${id}/detail`),
  });

export function useSubtitleSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: "movie" | "episode"; id: number; series_id?: number | null }) =>
      api.post<void>("/subtitles/search", input),
    onSettled: () => qc.invalidateQueries({ queryKey: ["subtitles"] }),
  });
}

export const useMediaRequests = (enabled: boolean) =>
  useQuery({
    queryKey: ["requests"],
    queryFn: () => api.get<ServiceBlock<MediaRequest[]>>("/requests?filter=pending"),
    enabled,
    refetchInterval: MEDIUM,
  });

export function useRequestAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "decline" }) =>
      api.post<void>(`/requests/${id}/${action}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

export const useSeriesDetail = (id: number) =>
  useQuery({
    queryKey: ["seriesDetail", id],
    queryFn: () => api.get<SeriesDetail>(`/library/series/${id}/detail`),
  });

export const useSeriesEpisodes = (id: number, season: number | null) =>
  useQuery({
    queryKey: ["seriesEpisodes", id, season],
    queryFn: () => api.get<Episode[]>(`/library/series/${id}/episodes?season=${season}`),
    enabled: season != null,
  });

export function useSeasonSearch(seriesId: number) {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (season: number) =>
      api.post<void>(`/library/series/${seriesId}/seasons/${season}/search`),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

export function useEpisodeMonitor(seriesId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, monitored }: { ids: number[]; monitored: boolean }) =>
      api.patch<void>("/library/episodes/monitor", { ids, monitored }),
    onMutate: async ({ ids, monitored }) => {
      await qc.cancelQueries({ queryKey: ["seriesEpisodes", seriesId] });
      qc.setQueriesData<Episode[]>({ queryKey: ["seriesEpisodes", seriesId] }, (old) =>
        old?.map((e) => (ids.includes(e.id) ? { ...e, monitored } : e)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["seriesEpisodes", seriesId] }),
  });
}

export function useEpisodeSearch() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (ids: number[]) => api.post<void>("/library/episodes/search", { ids }),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

export const useArrReleases = (
  app: "radarr" | "sonarr",
  params: { movieId?: number; seriesId?: number; season?: number; episodeId?: number },
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["arrReleases", app, params],
    queryFn: () => {
      if (app === "radarr") return api.get<ArrRelease[]>(`/releases/movie/${params.movieId}`);
      const qs =
        params.episodeId != null
          ? `episode_id=${params.episodeId}`
          : `season=${params.season}`;
      return api.get<ArrRelease[]>(`/releases/series/${params.seriesId}?${qs}`);
    },
    enabled,
    staleTime: 120_000,
    retry: false,
  });

export function useGrabArrRelease(app: "radarr" | "sonarr") {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (input: { guid: string; indexer_id: number }) =>
      api.post<void>(`/releases/${app}/grab`, input),
    onSuccess: () => toast.success(t("toast.grabbed")),
  });
}

export const useHistoryPage = (page: number) =>
  useQuery({
    queryKey: ["historyAll", page],
    queryFn: () => api.get<HistoryPage>(`/history/all?page=${page}`),
    staleTime: 60_000,
  });

export const useStatsHistory = (days = 30) =>
  useQuery({
    queryKey: ["statsHistory", days],
    queryFn: () => api.get<StatsSample[]>(`/stats/history?days=${days}`),
    staleTime: 600_000,
  });

export const useCalendar = () =>
  useQuery({
    queryKey: ["calendar"],
    queryFn: () =>
      api.get<{ radarr: ServiceBlock<CalendarItem[]>; sonarr: ServiceBlock<CalendarItem[]> }>(
        "/calendar",
      ),
    refetchInterval: SLOW,
  });

export const useHistory = () =>
  useQuery({
    queryKey: ["history"],
    queryFn: () =>
      api.get<{ radarr: ServiceBlock<HistoryItem[]>; sonarr: ServiceBlock<HistoryItem[]> }>(
        "/history",
      ),
    refetchInterval: MEDIUM,
  });

export const useIndexerStats = () =>
  useQuery({
    queryKey: ["indexerStats"],
    queryFn: () => api.get<ServiceBlock<IndexerStats>>("/indexers/stats"),
    refetchInterval: SLOW,
  });

export const useDiscover = (kind: "movies" | "series", enabled: boolean) =>
  useQuery({
    queryKey: ["discover", kind],
    queryFn: () => api.get<SearchResult[]>(`/discover/${kind}`),
    enabled,
    staleTime: 600_000,
  });

export const useSearch = (kind: "movies" | "series" | "releases", q: string) =>
  useQuery<Release[] | SearchResult[]>({
    queryKey: ["search", kind, q],
    queryFn: () =>
      kind === "releases"
        ? api.get<Release[]>(`/search/releases?q=${encodeURIComponent(q)}`)
        : api.get<SearchResult[]>(`/search/${kind}?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 1,
    staleTime: 60_000,
  });

export const useOptions = (app: "radarr" | "sonarr") =>
  useQuery({
    queryKey: ["options", app],
    queryFn: () => api.get<Options>(`/options/${app}`),
    staleTime: SLOW,
  });

export function useAddMedia() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    onSuccess: () => toast.success(t("toast.added")),
    mutationFn: (input: {
      kind: "movie" | "series";
      remote_id: number;
      title: string;
      quality_profile_id: number;
      root_folder_path: string;
    }) =>
      input.kind === "movie"
        ? api.post("/movies", {
            tmdb_id: input.remote_id,
            title: input.title,
            quality_profile_id: input.quality_profile_id,
            root_folder_path: input.root_folder_path,
          })
        : api.post("/series", {
            tvdb_id: input.remote_id,
            title: input.title,
            quality_profile_id: input.quality_profile_id,
            root_folder_path: input.root_folder_path,
          }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["discover"] });
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["collectionDetail"] });
    },
  });
}

export function useGrabRelease() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (input: { guid: string; indexer_id: number }) =>
      api.post<void>("/releases/grab", input),
    onSuccess: () => toast.success(t("toast.grabbed")),
  });
}

export const useIndexers = () =>
  useQuery({ queryKey: ["indexers"], queryFn: () => api.get<Indexer[]>("/indexers") });

export const useIndexerSchemas = (enabled: boolean) =>
  useQuery({
    queryKey: ["indexerSchemas"],
    queryFn: () => api.get<IndexerSchema[]>("/indexers/schemas"),
    enabled,
    staleTime: 3_600_000,
  });

export function useAddIndexer() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (input: {
      schema_name: string;
      display_name: string;
      field_values: Record<string, unknown>;
    }) => api.post<{ id: number; name: string }>("/indexers", input),
    onSuccess: () => toast.success(t("toast.indexerAdded")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["indexers"] }),
  });
}

export function useTestNewIndexer() {
  return useMutation({
    mutationFn: (input: {
      schema_name: string;
      display_name: string;
      field_values: Record<string, unknown>;
    }) => api.post<void>("/indexers/test-new", input),
  });
}

export function useToggleIndexer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: number; enable: boolean }) =>
      api.patch(`/indexers/${id}?enable=${enable}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["indexers"] }),
  });
}

export function useTestIndexer() {
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/indexers/${id}/test`),
  });
}

export const useLibraryMovies = () =>
  useQuery({
    queryKey: ["library", "movies"],
    queryFn: () => api.get<LibraryMovie[]>("/library/movies"),
    staleTime: 60_000,
  });

export const useLibrarySeries = () =>
  useQuery({
    queryKey: ["library", "series"],
    queryFn: () => api.get<LibrarySeries[]>("/library/series"),
    staleTime: 60_000,
  });

export function useTriggerSearch() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.post<void>(`/library/${app}/${id}/search`),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

export function useUpdateLibraryItem(kind: "movies" | "series") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      monitored,
      quality_profile_id,
    }: {
      id: number;
      monitored?: boolean;
      quality_profile_id?: number;
    }) => api.patch(`/library/${kind}/${id}`, { monitored, quality_profile_id }),
    onMutate: async ({ id, monitored, quality_profile_id }) => {
      await qc.cancelQueries({ queryKey: ["library", kind] });
      const prev = qc.getQueryData<{ id: number }[]>(["library", kind]);
      qc.setQueryData<Record<string, unknown>[]>(["library", kind], (old) =>
        old?.map((item) =>
          item.id === id
            ? {
                ...item,
                ...(monitored !== undefined ? { monitored } : {}),
                ...(quality_profile_id !== undefined ? { quality_profile_id } : {}),
              }
            : item,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["library", kind], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useDeleteLibraryItem(kind: "movies" | "series") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      api.delete<void>(`/library/${kind}/${id}?delete_files=${deleteFiles}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useSeasonMonitor(seriesId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ season, monitored }: { season: number; monitored: boolean }) =>
      api.post<void>(`/library/series/${seriesId}/seasons/${season}/monitor`, { monitored }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["seriesDetail", seriesId] }),
  });
}


export const usePopular = (hours: number) =>
  useQuery({
    queryKey: ["popular", hours],
    queryFn: () => api.get<ServiceBlock<PopularSnapshot>>(`/popular?hours=${hours}&limit=10`),
    // served from an hourly snapshot, so polling more often gains nothing
    refetchInterval: 600_000,
  });
