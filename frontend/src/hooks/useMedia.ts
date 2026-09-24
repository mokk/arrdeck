// Discovery, search, adding titles, the calendar, history and the popular page.
// Movies, series, episodes, discovery, calendar and history.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  CalendarItem,
  HistoryItem,
  HistoryPage,
  PopularSnapshot,
  RecentItem,
  Release,
  SearchResult,
  ServiceBlock,
} from "../api/types";
import { MEDIUM, SLOW } from "./shared";

export const useRecent = () =>
  useQuery({
    queryKey: ["recent"],
    queryFn: () => api.get<RecentItem[]>("/dashboard/recent"),
    refetchInterval: 60_000,
  });

export const useCalendarRange = (startDate: string, days: number) =>
  useQuery({
    queryKey: ["calendarRange", startDate, days],
    queryFn: () =>
      api.get<{
        radarr: ServiceBlock<CalendarItem[]>;
        sonarr: ServiceBlock<CalendarItem[]>;
        // only when Readarr is configured
        readarr?: ServiceBlock<CalendarItem[]>;
      }>(`/calendar?days=${days}&start_date=${startDate}`),
    staleTime: 300_000,
    // widening the window keeps what is on screen while the rest loads
    placeholderData: keepPreviousData,
  });

export const useHistoryPage = (page: number) =>
  useQuery({
    queryKey: ["historyAll", page],
    queryFn: () => api.get<HistoryPage>(`/history/all?page=${page}`),
    staleTime: 60_000,
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

export const useDiscover = (kind: "movies" | "series", enabled: boolean) =>
  useQuery({
    queryKey: ["discover", kind],
    queryFn: () => api.get<SearchResult[]>(`/discover/${kind}`),
    enabled,
    staleTime: 600_000,
  });

export const useSearch = (kind: "movies" | "series" | "books" | "releases", q: string) =>
  useQuery<Release[] | SearchResult[]>({
    queryKey: ["search", kind, q],
    queryFn: () =>
      kind === "releases"
        ? api.get<Release[]>(`/search/releases?q=${encodeURIComponent(q)}`)
        : api.get<SearchResult[]>(`/search/${kind}?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 1,
    staleTime: 60_000,
  });

export function useAddMedia() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    onSuccess: () => toast.success(t("toast.added")),
    mutationFn: (input: {
      kind: "movie" | "series" | "book";
      remote_id: number;
      title: string;
      quality_profile_id: number;
      root_folder_path: string;
      // books: Readarr's foreign ids, and the author's metadata profile
      foreign_id?: string | null;
      foreign_edition_id?: string | null;
      metadata_profile_id?: number | null;
    }) =>
      input.kind === "movie"
        ? api.post("/movies", {
            tmdb_id: input.remote_id,
            title: input.title,
            quality_profile_id: input.quality_profile_id,
            root_folder_path: input.root_folder_path,
          })
        : input.kind === "series"
          ? api.post("/series", {
              tvdb_id: input.remote_id,
              title: input.title,
              quality_profile_id: input.quality_profile_id,
              root_folder_path: input.root_folder_path,
            })
          : api.post("/books", {
              foreign_book_id: input.foreign_id,
              foreign_edition_id: input.foreign_edition_id,
              title: input.title,
              quality_profile_id: input.quality_profile_id,
              metadata_profile_id: input.metadata_profile_id,
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

/** Radarr's own suggestions from the library, and dismissing one for good. */
export const useRecommendations = (enabled: boolean) =>
  useQuery({
    queryKey: ["recommendations"],
    queryFn: () => api.get<SearchResult[]>("/discover/recommendations"),
    enabled,
    staleTime: 30 * 60_000,
  });

export const usePlexWatchlist = (enabled: boolean) =>
  useQuery({
    queryKey: ["plexWatchlist"],
    queryFn: () => api.get<SearchResult[]>("/plex/watchlist"),
    enabled,
    staleTime: 5 * 60_000,
  });

export const useTraktList = (kind: "movie" | "series", which: string) =>
  useQuery({
    queryKey: ["trakt", kind, which],
    queryFn: () => api.get<SearchResult[]>(`/discover/trakt?kind=${kind}&which=${which}`),
    staleTime: 30 * 60_000,
    retry: false,
  });

export function useDismissRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tmdbId: number) =>
      api.post<void>(`/discover/recommendations/${tmdbId}/dismiss`),
    onMutate: (tmdbId) =>
      qc.setQueryData<SearchResult[]>(["recommendations"], (old) =>
        old?.filter((r) => r.remote_id !== tmdbId),
      ),
  });
}

export const usePopular = (hours: number) =>
  useQuery({
    queryKey: ["popular", hours],
    queryFn: () => api.get<ServiceBlock<PopularSnapshot>>(`/popular?hours=${hours}&limit=10`),
    // served from an hourly snapshot, so polling more often gains nothing
    refetchInterval: 600_000,
  });
