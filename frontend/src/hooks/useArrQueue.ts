// The arr download queue: blocklist-and-retry, force and manual import, renaming.
// Torrent clients, the arr queue, manual import and renaming.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  BlocklistPage,
  ImportCandidate,
  RenamePreview,
  QueueItem,
  ServiceBlock,
} from "../api/types";
import { FAST } from "./shared";

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

/** Filtering and sorting happen server-side: the stack holds ~1,800 torrents and
 * shipping all of them every 5s cost hundreds of MB an hour. Each client is
 * capped independently, which is still correct once both lists are merged. */

export function useQueueRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: "radarr" | "sonarr"; id: number }) =>
      api.delete<void>(`/queue/${app}/${id}?remove_from_client=true`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}
