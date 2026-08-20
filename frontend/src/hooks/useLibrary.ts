// Movies, series, episodes, seasons, collections, tags and bulk actions.
// Movies, series, episodes, discovery, calendar and history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  ArrRelease,
  MovieDetail,
  Collection,
  CollectionDetail,
  Episode,
  SeriesDetail,
  Tag,
  WantedPage,
  LibraryMovie,
  LibrarySeries,
  Options,
} from "../api/types";
import { SLOW } from "./shared";

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

export const useMovieDetail = (id: number) =>
  useQuery({
    queryKey: ["movieDetail", id],
    queryFn: () => api.get<MovieDetail>(`/library/movies/${id}/detail`),
  });

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

export const useOptions = (app: "radarr" | "sonarr") =>
  useQuery({
    queryKey: ["options", app],
    queryFn: () => api.get<Options>(`/options/${app}`),
    staleTime: SLOW,
  });

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
