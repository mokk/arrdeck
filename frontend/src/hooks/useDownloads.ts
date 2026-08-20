// Torrent clients: the list, per-torrent actions, tags and the throttle.
// Torrent clients, the arr queue, manual import and renaming.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  TorrentSummary,
  TorrentDetails,
  ServiceBlock,
  SpeedLimit,
  Torrent,
  TorrentGroup,
} from "../api/types";
import { FAST, MEDIUM, SLOW, TorrentsCache } from "./shared";

type TorrentQuery = {
  q?: string;
  state?: string;
  sort?: string;
  dir?: string;
  limit?: number;
};

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

export const useTorrentDetails = (client: string, id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["torrentDetails", client, id],
    queryFn: () => api.get<TorrentDetails>(`/torrents/${client}/${id}/details`),
    enabled,
  });

export const useSpeedLimit = (enabled: boolean) =>
  useQuery({
    queryKey: ["speedLimit"],
    queryFn: () => api.get<SpeedLimit>("/torrents/speed-limit"),
    enabled,
    refetchInterval: MEDIUM,
  });

export function useSetSpeedLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clients, enabled }: { clients: string[]; enabled: boolean }) => {
      // one call per client: they don't share a throttle
      for (const client of clients) {
        await api.post<void>(`/torrents/${client}/speed-limit`, { enabled });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["speedLimit"] }),
  });
}

export function useTorrentPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      client,
      ids,
      position,
    }: {
      client: string;
      ids: string[];
      position: "top" | "bottom" | "up" | "down";
    }) => api.post<void>(`/torrents/${client}/priority`, { ids, position }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["torrents"] }),
  });
}

export function useTorrentForceStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, value }: { ids: string[]; value: boolean }) =>
      api.post<void>("/torrents/qbittorrent/force-start", { ids, value }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["torrents"] }),
  });
}

export const useQbitTags = (enabled: boolean) =>
  useQuery({
    queryKey: ["qbitTags"],
    queryFn: () => api.get<string[]>("/torrents/qbittorrent/tags"),
    enabled,
    staleTime: SLOW,
  });

export function useTorrentTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, tags, remove }: { ids: string[]; tags: string[]; remove?: boolean }) =>
      api.post<void>("/torrents/qbittorrent/tags", { ids, tags, remove }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["qbitTags"] });
      qc.invalidateQueries({ queryKey: ["torrents"] });
    },
  });
}

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

export const useTorrents = (query: TorrentQuery = {}) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.state && query.state !== "all") params.set("state", query.state);
  if (query.sort) params.set("sort", query.sort);
  if (query.dir) params.set("dir", query.dir);
  if (query.limit) params.set("limit", String(query.limit));
  const suffix = params.toString() ? `?${params}` : "";
  return useQuery({
    queryKey: ["torrents", suffix],
    queryFn: () =>
      api.get<{
        qbittorrent: ServiceBlock<TorrentGroup>;
        transmission: ServiceBlock<TorrentGroup>;
      }>(`/torrents${suffix}`),
    refetchInterval: FAST,
    // keep the previous page on screen while a filter change is in flight
    placeholderData: (prev) => prev,
  });
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
