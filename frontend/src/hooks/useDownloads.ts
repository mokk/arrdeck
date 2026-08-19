// Torrent clients, the arr queue, manual import and renaming.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  TorrentSummary,
  BlocklistPage,
  ImportCandidate,
  RenamePreview,
  TorrentDetails,
  QueueItem,
  ServiceBlock,
  SpeedLimit,
  Torrent,
  TorrentGroup,
} from "../api/types";
import { FAST, MEDIUM, SLOW, TorrentsCache } from "./shared";

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

export const useBlocklist = (enabled: boolean) =>
  useQuery({
    queryKey: ["blocklist"],
    queryFn: () => api.get<BlocklistPage>("/blocklist"),
    enabled,
  });

export function useBlocklistRemove() {
  const qc = useQueryClient();
  return useMutation({
    // no id clears the whole list for that app
    mutationFn: ({ app, id }: { app: string; id?: number }) =>
      api.delete<void>(id ? `/blocklist/${app}/${id}` : `/blocklist/${app}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["blocklist"] }),
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

export const useImportCandidates = (app: string, itemId: number | null) =>
  useQuery({
    queryKey: ["importCandidates", app, itemId],
    queryFn: () => api.get<ImportCandidate[]>(`/manual-import/${app}/${itemId}`),
    enabled: itemId != null,
  });

export function useManualImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, itemId, paths }: { app: string; itemId: number; paths: string[] }) =>
      api.post<void>(`/manual-import/${app}`, { item_id: itemId, paths }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

export function useManualImportAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      app,
      itemId,
      files,
    }: {
      app: string;
      itemId: number;
      files: {
        path: string;
        movie_id?: number | null;
        series_id?: number | null;
        episode_ids?: number[];
      }[];
    }) => api.post<void>(`/manual-import/${app}/assign`, { item_id: itemId, files }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

export const useRenamePreview = (app: string, id: number, enabled: boolean) =>
  useQuery({
    queryKey: ["renamePreview", app, id],
    queryFn: () => api.get<RenamePreview[]>(`/rename/${app}/${id}`),
    enabled,
  });

export function useRenameFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id, fileIds }: { app: string; id: number; fileIds: number[] }) =>
      api.post<void>(`/rename/${app}`, { id, file_ids: fileIds }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ["renamePreview", v.app, v.id] });
      qc.invalidateQueries({ queryKey: ["movieDetail"] });
      qc.invalidateQueries({ queryKey: ["seriesDetail"] });
    },
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

export const useQueue = () =>
  useQuery({
    queryKey: ["queue"],
    queryFn: () =>
      api.get<{ radarr: ServiceBlock<QueueItem[]>; sonarr: ServiceBlock<QueueItem[]> }>("/queue"),
    refetchInterval: FAST,
  });

export type TorrentQuery = {
  q?: string;
  state?: string;
  sort?: string;
  dir?: string;
  limit?: number;
};

/** Filtering and sorting happen server-side: the stack holds ~1,800 torrents and
 * shipping all of them every 5s cost hundreds of MB an hour. Each client is
 * capped independently, which is still correct once both lists are merged. */

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

export function useQueueRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.delete<void>(`/queue/${app}/${id}?remove_from_client=true`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}
