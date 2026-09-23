// Movies, series, episodes, seasons, collections, tags and bulk actions.
// Movies, series, episodes, discovery, calendar and history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  ArrApp,
  ArrRelease,
  Author,
  AuthorDetail,
  BookDetail,
  Cleanup,
  CleanupItem,
  Collection,
  CollectionDetail,
  Credits,
  Diagnosis,
  EditionChoice,
  Episode,
  LibraryBook,
  LibraryKind,
  LibraryMovie,
  LibrarySeries,
  MovieDetail,
  OpdsSettings,
  Options,
  Person,
  Reading,
  SeriesDetail,
  ShelfSeries,
  Tag,
  WantedPage,
} from "../api/types";
import { SLOW } from "./shared";

export const useWanted = (app: ArrApp, kind: "missing" | "cutoff", page: number) =>
  useQuery({
    queryKey: ["wanted", app, kind, page],
    queryFn: () => api.get<WantedPage>(`/wanted/${app}?kind=${kind}&page=${page}`),
    staleTime: 60_000,
  });

export function useWantedSearchAll() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, kind }: { app: ArrApp; kind: string }) =>
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

export const useTags = (app: ArrApp, enabled = true) =>
  useQuery({
    queryKey: ["tags", app],
    queryFn: () => api.get<Tag[]>(`/tags/${app}`),
    enabled,
    staleTime: SLOW,
  });

export function useBulkLibrary(kind: LibraryKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      ids: number[];
      monitored?: boolean;
      quality_profile_id?: number;
      tags?: number[];
      apply_tags?: "add" | "remove" | "replace";
    }) => api.post<void>(`/library/${kind}/bulk`, input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useBulkDeleteLibrary(kind: LibraryKind) {
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

export type ReadingStatus = Reading["status"];

/** Reading status for every book that has one, keyed by book id. */
export const useReading = (enabled = true) =>
  useQuery({
    queryKey: ["reading"],
    queryFn: () => api.get<Record<string, Reading>>("/library/books/reading"),
    enabled,
    staleTime: 60_000,
  });

export function useSetReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ReadingStatus | null }) =>
      api.put<Record<string, Reading>>(`/library/books/${id}/reading`, { status }),
    onSuccess: (map) => qc.setQueryData(["reading"], map),
  });
}

export const useOpdsSettings = () =>
  useQuery({ queryKey: ["opds"], queryFn: () => api.get<OpdsSettings>("/opds/settings") });

export function useOpdsToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enable: boolean) =>
      enable
        ? api.post<OpdsSettings>("/opds/settings/token")
        : api.delete<OpdsSettings>("/opds/settings/token"),
    onSuccess: (data) => qc.setQueryData(["opds"], data),
  });
}

export const useCleanup = (watchedDays: number) =>
  useQuery({
    queryKey: ["cleanup", watchedDays],
    queryFn: () => api.get<Cleanup>(`/cleanup?watched_days=${watchedDays}`),
    staleTime: 60_000,
  });

/** Deletes the chosen titles with their files, films and shows each through
 * their own arr; `exclude` stops the arrs' import lists adding them back. */
export function useCleanupDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ items, exclude }: { items: CleanupItem[]; exclude: boolean }) => {
      const ids = (kind: CleanupItem["kind"]) =>
        items.filter((i) => i.kind === kind).map((i) => i.id);
      const calls = [];
      if (ids("movie").length)
        calls.push(
          api.post<void>("/library/movies/bulk-delete", {
            ids: ids("movie"),
            delete_files: true,
            exclude,
          }),
        );
      if (ids("series").length)
        calls.push(
          api.post<void>("/library/series/bulk-delete", {
            ids: ids("series"),
            delete_files: true,
            exclude,
          }),
        );
      await Promise.all(calls);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["cleanup"] });
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["disk"] });
    },
  });
}

export function useBulkSearchLibrary(kind: LibraryKind) {
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

/** One-shot on demand: the sheet is opened deliberately, and every input behind
 * it is cached server-side, so there is nothing to poll for. */
export const useDiagnose = (app: string, id: number) =>
  useQuery({
    queryKey: ["diagnose", app, id],
    queryFn: () => api.get<Diagnosis>(`/diagnose/${app}/${id}`),
  });

/** Credits change almost never, so they are a separate query from the detail —
 * the page refetches monitoring and file state far more often than this. */
export const usePerson = (tmdbId: number) =>
  useQuery({
    queryKey: ["person", tmdbId],
    queryFn: () => api.get<Person>(`/library/people/${tmdbId}`),
    staleTime: 10 * 60_000,
  });

export const useMovieCredits = (id: number) =>
  useQuery({
    queryKey: ["movieCredits", id],
    queryFn: () => api.get<Credits>(`/library/movies/${id}/credits`),
    staleTime: SLOW,
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
  app: ArrApp,
  params: {
    movieId?: number;
    seriesId?: number;
    season?: number;
    episodeId?: number;
    bookId?: number;
  },
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["arrReleases", app, params],
    queryFn: () => {
      if (app === "radarr") return api.get<ArrRelease[]>(`/releases/movie/${params.movieId}`);
      if (app === "readarr") return api.get<ArrRelease[]>(`/releases/book/${params.bookId}`);
      const qs =
        params.episodeId != null ? `episode_id=${params.episodeId}` : `season=${params.season}`;
      return api.get<ArrRelease[]>(`/releases/series/${params.seriesId}?${qs}`);
    },
    enabled,
    staleTime: 120_000,
    retry: false,
  });

export function useGrabArrRelease(app: ArrApp) {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (input: { guid: string; indexer_id: number }) =>
      api.post<void>(`/releases/${app}/grab`, input),
    onSuccess: () => toast.success(t("toast.grabbed")),
  });
}

export const useOptions = (app: ArrApp) =>
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

export const useLibraryBooks = () =>
  useQuery({
    queryKey: ["library", "books"],
    queryFn: () => api.get<LibraryBook[]>("/library/books"),
    staleTime: 60_000,
  });

export const useBookShelf = (enabled: boolean) =>
  useQuery({
    queryKey: ["library", "books", "shelf"],
    queryFn: () => api.get<ShelfSeries[]>("/library/books/shelf"),
    enabled,
    staleTime: 5 * 60_000,
  });

export const useBookDetail = (id: number) =>
  useQuery({
    queryKey: ["bookDetail", id],
    queryFn: () => api.get<BookDetail>(`/library/books/${id}/detail`),
  });

export function useTriggerSearch() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: ArrApp; id: number }) =>
      api.post<void>(`/library/${app}/${id}/search`),
    onSuccess: () => toast.success(t("toast.searchStarted")),
  });
}

const DETAIL_KEY: Record<LibraryKind, string> = {
  movies: "movieDetail",
  series: "seriesDetail",
  books: "bookDetail",
};

export function useUpdateLibraryItem(kind: LibraryKind) {
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
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ["library", kind] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["discover"] });
      // The detail pages read their own query, not the list. Without this the
      // Monitor button kept its old label after a successful toggle, because
      // only the list cache was patched.
      qc.invalidateQueries({ queryKey: [DETAIL_KEY[kind], id] });
      if (kind === "books") qc.invalidateQueries({ queryKey: ["author"] });
    },
  });
}

export function useDeleteLibraryItem(kind: LibraryKind) {
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

export function useDeleteEpisodeFile(seriesId: number) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (fileId: number) => api.delete<void>(`/library/episodes/files/${fileId}`),
    onSuccess: () => toast.success(t("episode.fileDeleted")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["seriesEpisodes", seriesId] });
      qc.invalidateQueries({ queryKey: ["seriesDetail", seriesId] });
    },
  });
}

export const useAuthor = (id: number) =>
  useQuery({
    queryKey: ["author", id],
    queryFn: () => api.get<AuthorDetail>(`/library/authors/${id}`),
  });

export function useUpdateAuthor(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      monitored?: boolean;
      monitor_new_items?: "all" | "none" | "new";
      quality_profile_id?: number;
      metadata_profile_id?: number;
    }) => api.patch<Author>(`/library/authors/${id}`, input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["author", id] });
      qc.invalidateQueries({ queryKey: ["library", "books"] });
    },
  });
}

/** Every edition of the work one edition belongs to; empty against upstream
 * Readarr, whose lookup carries none. */
export const useBookEditions = (editionId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["bookEditions", editionId],
    queryFn: () =>
      api.get<EditionChoice[]>(
        `/search/books/editions?edition=${encodeURIComponent(editionId ?? "")}`,
      ),
    enabled: enabled && !!editionId,
    staleTime: SLOW,
  });
