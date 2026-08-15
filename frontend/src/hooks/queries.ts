import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  ArrRelease,
  MovieDetail,
  TorrentSummary,
  CalendarItem,
  Collection,
  CollectionDetail,
  Episode,
  HistoryItem,
  HistoryPage,
  RecentItem,
  SeriesDetail,
  StatsSample,
  TorrentDetails,
  WantedPage,
  Indexer,
  IndexerSchema,
  IndexerStats,
  LibraryMovie,
  LibrarySeries,
  Options,
  QueueItem,
  Release,
  SearchResult,
  ServiceBlock,
  ServiceInfo,
  ServiceSettings,
  ServiceStatus,
  Torrent,
  TorrentGroup,
} from "../api/types";

const FAST = 5_000;
const MEDIUM = 30_000;
const SLOW = 300_000;

export const useAuthState = () =>
  useQuery({
    queryKey: ["authState"],
    queryFn: () =>
      api.get<{ authenticated: boolean; lan: boolean; has_credentials: boolean }>("/auth/state"),
    staleTime: 30_000,
    retry: false,
  });

export const useSetupCode = (enabled: boolean) =>
  useQuery({
    queryKey: ["setupCode"],
    queryFn: () => api.get<{ code: string }>("/auth/setup-code"),
    enabled,
    retry: false,
  });

export const usePasskeys = (enabled: boolean) =>
  useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get<{ id: number; name: string; created: number }[]>("/auth/credentials"),
    enabled,
    retry: false,
  });

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/auth/credentials/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => qc.invalidateQueries(),
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

export function useBulkLibrary(kind: "movies" | "series") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; monitored?: boolean; quality_profile_id?: number }) =>
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

export function useForceImport() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.post<void>(`/queue/${app}/${id}/force-import`),
    onSuccess: () => toast.success(t("toast.importStarted")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
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

export function useImportSettings() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (services: Record<string, unknown>) =>
      api.post<void>("/settings/import", { services }),
    onSuccess: () => toast.success(t("toast.settingsImported")),
    onSettled: () => qc.invalidateQueries(),
  });
}

export const useQbitCategories = (enabled: boolean) =>
  useQuery({
    queryKey: ["qbitCategories"],
    queryFn: () => api.get<string[]>("/torrents/qbittorrent/categories"),
    enabled,
    staleTime: 300_000,
  });

export function useAddTorrent() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (input: {
      client: string;
      url?: string;
      file?: File;
      category: string;
      paused: boolean;
    }) => {
      if (input.file) {
        const form = new FormData();
        form.append("file", input.file);
        form.append("category", input.category);
        form.append("paused", String(input.paused));
        return api.postForm<void>(`/torrents/${input.client}/add-file`, form);
      }
      return api.post<void>(`/torrents/${input.client}/add`, {
        url: input.url,
        category: input.category,
        paused: input.paused,
      });
    },
    onSuccess: () => toast.success(t("toast.torrentAdded")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["torrents"] }),
  });
}

export const useTorrentsSummary = () =>
  useQuery({
    queryKey: ["torrentsSummary"],
    queryFn: () =>
      api.get<{
        qbittorrent: ServiceBlock<TorrentSummary>;
        transmission: ServiceBlock<TorrentSummary>;
      }>("/torrents/summary"),
    refetchInterval: FAST,
  });

export const useMovieDetail = (id: number) =>
  useQuery({
    queryKey: ["movieDetail", id],
    queryFn: () => api.get<MovieDetail>(`/library/movies/${id}/detail`),
  });

export function useTorrentFileToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      client,
      id,
      index,
      wanted,
    }: {
      client: string;
      id: string;
      index: number;
      wanted: boolean;
    }) => api.post<void>(`/torrents/${client}/${id}/files`, { index, wanted }),
    onMutate: async ({ client, id, index, wanted }) => {
      await qc.cancelQueries({ queryKey: ["torrentDetails", client, id] });
      qc.setQueryData<TorrentDetails>(["torrentDetails", client, id], (old) =>
        old
          ? {
              ...old,
              files: (old.files ?? []).map((f) => (f.index === index ? { ...f, wanted } : f)),
            }
          : old,
      );
    },
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: ["torrentDetails", v.client, v.id] }),
  });
}

export const useVapidKey = (enabled: boolean) =>
  useQuery({
    queryKey: ["vapidKey"],
    queryFn: () => api.get<{ key: string }>("/push/vapid"),
    enabled,
    staleTime: Infinity,
  });

export function usePushSubscribe() {
  return useMutation({
    mutationFn: (input: { subscription: unknown; unsubscribe?: boolean }) =>
      api.post<void>(input.unsubscribe ? "/push/unsubscribe" : "/push/subscribe", {
        subscription: input.subscription,
      }),
  });
}

export const useTorrentDetails = (client: string, id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["torrentDetails", client, id],
    queryFn: () => api.get<TorrentDetails>(`/torrents/${client}/${id}/details`),
    enabled,
  });

export function useTorrentRecheck() {
  return useMutation({
    mutationFn: ({ client, ids }: { client: string; ids: string[] }) =>
      api.post<void>(`/torrents/${client}/recheck`, { ids }),
  });
}

export function useTorrentLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      client,
      id,
      dl_kib,
      ul_kib,
    }: {
      client: string;
      id: string;
      dl_kib: number;
      ul_kib: number;
    }) => api.post<void>(`/torrents/${client}/${id}/limits`, { dl_kib, ul_kib }),
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: ["torrentDetails", v.client, v.id] }),
  });
}

export function useTorrentCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      api.post<void>(`/torrents/qbittorrent/${id}/category`, { category }),
    onSettled: (_d, _e, v) =>
      qc.invalidateQueries({ queryKey: ["torrentDetails", "qbittorrent", v.id] }),
  });
}

export function useBlocklistRetry() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.post<void>(`/queue/${app}/${id}/blocklist-retry`),
    onSuccess: () => toast.success(t("toast.retried")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
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

export function useSeasonMonitor(seriesId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ season, monitored }: { season: number; monitored: boolean }) =>
      api.post<void>(`/library/series/${seriesId}/seasons/${season}/monitor`, { monitored }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["seriesDetail", seriesId] }),
  });
}

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

export const useServices = () =>
  useQuery({
    queryKey: ["services"],
    queryFn: () => api.get<ServiceInfo[]>("/services"),
    staleTime: 30_000,
  });

export const useServiceSettings = () =>
  useQuery({
    queryKey: ["serviceSettings"],
    queryFn: () => api.get<Record<string, ServiceSettings>>("/settings/services"),
  });

export function useSaveServiceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ service, ...body }: { service: string } & Omit<ServiceSettings, "configured">) =>
      api.put<{ service: string; configured: boolean }>(`/settings/services/${service}`, body),
    // connection settings affect every query in the app
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useTestService() {
  return useMutation({
    mutationFn: (service: string) =>
      api.post<{ service: string; version: string }>(`/settings/services/${service}/test`),
  });
}

export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<ServiceStatus[]>("/status"),
    refetchInterval: MEDIUM,
  });

export const useQueue = () =>
  useQuery({
    queryKey: ["queue"],
    queryFn: () =>
      api.get<{ radarr: ServiceBlock<QueueItem[]>; sonarr: ServiceBlock<QueueItem[]> }>("/queue"),
    refetchInterval: FAST,
  });

export const useTorrents = () =>
  useQuery({
    queryKey: ["torrents"],
    queryFn: () =>
      api.get<{
        qbittorrent: ServiceBlock<TorrentGroup>;
        transmission: ServiceBlock<TorrentGroup>;
      }>("/torrents"),
    refetchInterval: FAST,
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

type TorrentsCache = {
  qbittorrent: ServiceBlock<TorrentGroup>;
  transmission: ServiceBlock<TorrentGroup>;
};

export function useTorrentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      client,
      action,
      ids,
      deleteData,
    }: {
      client: Torrent["client"];
      action: "pause" | "resume" | "delete";
      ids: string[];
      deleteData?: boolean;
    }) =>
      api.post<void>(
        `/torrents/${client}/${action}`,
        action === "delete" ? { ids, delete_data: deleteData ?? false } : { ids },
      ),
    // optimistic: flip states / remove rows instantly, roll back on error
    onMutate: async ({ client, action, ids }) => {
      await qc.cancelQueries({ queryKey: ["torrents"] });
      const prev = qc.getQueryData<TorrentsCache>(["torrents"]);
      qc.setQueryData<TorrentsCache>(["torrents"], (old) => {
        const group = old?.[client]?.data;
        if (!old || !group) return old;
        const torrents =
          action === "delete"
            ? (group.torrents ?? []).filter((t) => !ids.includes(t.id))
            : (group.torrents ?? []).map((t) =>
                ids.includes(t.id)
                  ? {
                      ...t,
                      state:
                        action === "pause"
                          ? t.progress >= 1
                            ? "completed"
                            : "paused"
                          : t.progress >= 1
                            ? "seeding"
                            : "downloading",
                      dl_speed: 0,
                      ul_speed: 0,
                    }
                  : t,
              );
        return { ...old, [client]: { ...old[client], data: { ...group, torrents } } };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["torrents"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["torrents"] }),
  });
}

export function useQueueRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.delete<void>(`/queue/${app}/${id}?remove_from_client=true`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

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
