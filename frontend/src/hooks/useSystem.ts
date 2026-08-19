// Services, auth, push, backups and the media-server integrations.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  ImportList,
  LogEntry,
  DiskSpace,
  HealthWarning,
  PlaySession,
  WatchedItem,
  Subtitles,
  VpnStatus,
  Session,
  PushEvents,
  PushRules,
  WebhookApp,
  WebhookStatus,
  ServiceBlock,
  ServiceInfo,
  ServiceSettings,
  ServiceStatus,
} from "../api/types";
import { FAST, MEDIUM, SLOW } from "./shared";

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

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => qc.invalidateQueries(),
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

export const useSessions = (enabled: boolean) =>
  useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/auth/sessions"),
    enabled,
  });

export function useRevokeSessions() {
  const qc = useQueryClient();
  return useMutation({
    // no id = sign out everywhere except here
    mutationFn: (id?: string) =>
      api.delete<{ revoked?: number }>(id ? `/auth/sessions/${id}` : "/auth/sessions"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export const useDiskSpace = (enabled: boolean) =>
  useQuery({
    queryKey: ["diskspace"],
    queryFn: () => api.get<ServiceBlock<DiskSpace[]>>("/diskspace"),
    enabled,
    refetchInterval: SLOW,
  });

export const useWatched = (enabled: boolean) =>
  useQuery({
    queryKey: ["watched"],
    queryFn: () => api.get<ServiceBlock<Record<string, WatchedItem>>>("/watched"),
    enabled,
    staleTime: SLOW,
  });

export const usePlaySessions = (enabled: boolean) =>
  useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<ServiceBlock<PlaySession[]>>("/sessions"),
    enabled,
    refetchInterval: FAST,
  });

export const useSubtitles = (enabled: boolean) =>
  useQuery({
    queryKey: ["subtitles"],
    queryFn: () => api.get<ServiceBlock<Subtitles>>("/subtitles"),
    enabled,
    refetchInterval: SLOW,
  });

export const useVpn = (enabled: boolean) =>
  useQuery({
    queryKey: ["vpn"],
    queryFn: () => api.get<ServiceBlock<VpnStatus>>("/vpn"),
    enabled,
    refetchInterval: MEDIUM,
  });

export const useHealth = (enabled: boolean) =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<ServiceBlock<HealthWarning[]>>("/health"),
    enabled,
    refetchInterval: SLOW,
  });

export const usePushEvents = (enabled: boolean, endpoint: string) =>
  useQuery({
    queryKey: ["pushEvents", endpoint],
    queryFn: () =>
      api.get<PushEvents>(`/push/events?endpoint=${encodeURIComponent(endpoint)}`),
    enabled,
    staleTime: Infinity,
  });

export function useSavePushEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: string[]; endpoint: string }) =>
      api.put<PushEvents>("/push/events", input),
    onSuccess: (data, input) => qc.setQueryData(["pushEvents", input.endpoint], data),
  });
}

export const usePushRules = () =>
  useQuery({
    queryKey: ["pushRules"],
    queryFn: () => api.get<PushRules>("/push/rules"),
  });

export function useSavePushRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: {
      quiet_start: string;
      quiet_end: string;
      timezone: string;
      tags: Record<string, number[]>;
    }) => api.put<PushRules>("/push/rules", rules),
    onSuccess: (data) => qc.setQueryData(["pushRules"], data),
  });
}

export function useTestPush() {
  return useMutation({
    mutationFn: (endpoint: string) => api.post<{ sent: number }>("/push/test", { endpoint }),
  });
}

export const useWebhookStatus = (enabled: boolean) =>
  useQuery({
    queryKey: ["webhookStatus"],
    queryFn: () => api.get<WebhookStatus>("/push/webhook"),
    enabled,
  });

export function useInstallWebhooks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseUrl: string; remove?: boolean }) =>
      input.remove
        ? api.post<WebhookApp[]>("/push/webhook/uninstall")
        : api.post<WebhookApp[]>("/push/webhook/install", { base_url: input.baseUrl }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["webhookStatus"] }),
  });
}

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


export const useImportLists = (enabled: boolean) =>
  useQuery({
    queryKey: ["importLists"],
    queryFn: () => api.get<ImportList[]>("/import-lists"),
    enabled,
  });

export function useToggleImportList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: string; id: number }) =>
      api.post<void>(`/import-lists/${app}/${id}/toggle`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["importLists"] }),
  });
}

export function useSyncImportLists() {
  return useMutation({
    mutationFn: (app: string) => api.post<void>(`/import-lists/${app}/sync`),
  });
}

export const useLogs = (app: string, level: string, enabled: boolean) =>
  useQuery({
    queryKey: ["logs", app, level],
    queryFn: () =>
      api.get<LogEntry[]>(`/logs/${app}?page=1${level ? `&level=${level}` : ""}`),
    enabled,
    refetchInterval: MEDIUM,
  });
