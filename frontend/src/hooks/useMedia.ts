// Discovery, search, adding titles, the calendar, history and the popular page.
// Movies, series, episodes, discovery, calendar and history.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  PopularSnapshot,
  CalendarItem,
  HistoryItem,
  HistoryPage,
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
      api.get<{ radarr: ServiceBlock<CalendarItem[]>; sonarr: ServiceBlock<CalendarItem[]> }>(
        `/calendar?days=${days}&start_date=${startDate}`,
      ),
    staleTime: 300_000,
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

export const usePopular = (hours: number) =>
  useQuery({
    queryKey: ["popular", hours],
    queryFn: () => api.get<ServiceBlock<PopularSnapshot>>(`/popular?hours=${hours}&limit=10`),
    // served from an hourly snapshot, so polling more often gains nothing
    refetchInterval: 600_000,
  });
