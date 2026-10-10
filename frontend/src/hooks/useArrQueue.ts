// The arr download queue: blocklist-and-retry, force and manual import, renaming.
// Torrent clients, the arr queue, manual import and renaming.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../api/client";
import type {
  ArrApp,
  BlocklistPage,
  ImportCandidate,
  ImportCommand,
  ImportFileChoice,
  ImportOptions,
  QueueItem,
  RenamePreview,
  ServiceBlock,
} from "../api/types";
import { FAST, IDLE, queueMoving } from "./shared";

export function useForceImport() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: ArrApp; id: number }) =>
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

export function useManualImportAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      app,
      itemId,
      files,
      mode = "auto",
    }: {
      app: string;
      itemId: number;
      files: ImportFileChoice[];
      mode?: "auto" | "move";
    }) =>
      api.post<ImportCommand>(`/manual-import/${app}/assign`, { item_id: itemId, files, mode }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

/** A finished torrent no arr is tracking, as the arr reads its folder. The
 * server finds the folder from the torrent client; only the torrent is sent. */
export const useTorrentImportCandidates = (
  app: string,
  torrent: { client: string; id: string } | null,
) =>
  useQuery({
    queryKey: ["importCandidates", app, torrent?.client, torrent?.id],
    queryFn: () =>
      api.get<ImportCandidate[]>(
        `/manual-import/${app}/torrent/${torrent?.client}/${encodeURIComponent(torrent?.id ?? "")}`,
      ),
    enabled: torrent != null,
    // a 409 (tracked, or a folder the arr can't see) won't change on a retry
    retry: false,
  });

export function useTorrentImport() {
  return useMutation({
    mutationFn: ({
      app,
      client,
      torrentId,
      files,
      mode,
    }: {
      app: string;
      client: string;
      torrentId: string;
      files: ImportFileChoice[];
      mode: "auto" | "move";
    }) =>
      api.post<ImportCommand>(`/manual-import/${app}/torrent`, {
        client,
        torrent_id: torrentId,
        files,
        mode,
      }),
  });
}

/** What a file's quality and languages can be corrected to in an import. */
export const useImportOptions = (app: string) =>
  useQuery({
    queryKey: ["importOptions", app],
    queryFn: () => api.get<ImportOptions>(`/manual-import/${app}/options`),
    staleTime: 10 * 60_000,
  });

/** Follows the arr's ManualImport command until it finishes; the queue is
 * refreshed then, since that is when the item actually leaves it. */
export const useImportCommand = (app: string, id: number | null) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["importCommand", app, id],
    queryFn: async () => {
      const command = await api.get<ImportCommand>(`/manual-import/${app}/command/${id}`);
      if (command.done) qc.invalidateQueries({ queryKey: ["queue"] });
      return command;
    },
    enabled: id != null,
    refetchInterval: (query) => (query.state.data?.done ? false : 1000),
  });
};

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
    mutationFn: ({ app, id }: { app: ArrApp; id: number }) =>
      api.post<void>(`/queue/${app}/${id}/blocklist-retry`),
    onSuccess: () => toast.success(t("toast.retried")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

/** Send a release a delay profile is holding to the download client now. */
export function useGrabNow() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ app, id }: { app: ArrApp; id: number }) =>
      api.post<void>(`/queue/${app}/${id}/grab`),
    onSuccess: () => toast.success(t("dl.grabbedNow")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

export const useQueue = () =>
  useQuery({
    queryKey: ["queue"],
    queryFn: () =>
      api.get<{
        radarr: ServiceBlock<QueueItem[]>;
        sonarr: ServiceBlock<QueueItem[]>;
        // optional: only present once Readarr is configured
        readarr?: ServiceBlock<QueueItem[]>;
      }>("/queue"),
    refetchInterval: (query) => (queueMoving(query.state.data) ? FAST : IDLE),
  });

/** Filtering and sorting happen server-side: the stack holds ~1,800 torrents and
 * shipping all of them every 5s cost hundreds of MB an hour. Each client is
 * capped independently, which is still correct once both lists are merged. */

export function useQueueRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: ArrApp; id: number }) =>
      api.delete<void>(`/queue/${app}/${id}?remove_from_client=true`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}
