import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../api/client";
import { passkeysSupported, registerPasskey } from "../../lib/passkey";
import { SERVICE_LABELS } from "../../api/format";
import i18n, { LANGUAGES, setLanguage } from "../../i18n";
import type { ServiceSettings } from "../../api/types";
import { Card, EmptyNote, ErrorNote } from "../Blocks";
import {
  useAuthState,
  useDeletePasskey,
  useRevokeSessions,
  useSessions,
  useLogout,
  usePasskeys,
  useSetupCode,
  useImportSettings,
  useInstallWebhooks,
  usePushEvents,
  useImportLists,
  usePushRules,
  useSyncImportLists,
  useToggleImportList,
  useSavePushRules,
  useTags,
  usePushSubscribe,
  useSavePushEvents,
  useTestPush,
  useWebhookStatus,
  useSaveServiceSettings,
  useServiceSettings,
  useStatus,
  useTestService,
  useVapidKey,
} from "../../hooks/queries";

/* ---------------- services (connection settings) ---------------- */

const SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
  radarr: ["url", "api_key"],
  sonarr: ["url", "api_key"],
  prowlarr: ["url", "api_key"],
  overseerr: ["url", "api_key"],
  qbittorrent: ["url", "username", "password"],
  transmission: ["url"],
  gluetun: ["url", "api_key"],
  bazarr: ["url", "api_key"],
  plex: ["url", "api_key"],
};

const FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

function ServiceSettingsCard({ name, initial }: { name: string; initial: ServiceSettings }) {
  const { t } = useTranslation();
  const save = useSaveServiceSettings();
  const test = useTestService();
  const [form, setForm] = useState({
    url: initial.url,
    api_key: initial.api_key,
    username: initial.username,
    password: initial.password,
  });
  const [result, setResult] = useState<string | null>(null);
  const dirty =
    form.url !== initial.url ||
    form.api_key !== initial.api_key ||
    form.username !== initial.username ||
    form.password !== initial.password;

  return (
    <Card>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{SERVICE_LABELS[name] ?? name}</span>
          <Badge
            variant="secondary"
            className={cn(
              "px-2 py-0 text-[0.68rem]",
              initial.configured ? "text-success" : "text-muted-foreground",
            )}
          >
            {initial.configured ? t("manage.configured") : t("manage.notConfigured")}
          </Badge>
          {result && (
            <span
              className={cn(
                "text-xs",
                result.startsWith("ok") ? "text-success" : "text-destructive",
              )}
            >
              {result}
            </span>
          )}
        </div>
        {SERVICE_FIELDS[name].map((field) => (
          <div key={field}>
            <Label className="mb-1 text-xs text-muted-foreground">{t(FIELD_KEYS[field])}</Label>
            <Input
              value={form[field]}
              placeholder={field === "url" ? t("manage.urlPlaceholder") : ""}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                { service: name, ...form },
                {
                  onSuccess: (r) =>
                    setResult(r.configured ? t("manage.savedOk") : t("manage.savedDisabled")),
                  onError: (e) => setResult(`error: ${(e as Error).message}`),
                },
              )
            }
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            variant="secondary"
            disabled={test.isPending || dirty}
            title={dirty ? t("manage.saveFirst") : t("manage.testSaved")}
            onClick={() =>
              test.mutate(name, {
                onSuccess: (r) => setResult(`ok: v${r.version}`),
                onError: (e) => setResult(`error: ${(e as Error).message}`),
              })
            }
          >
            {test.isPending ? t("common.testing") : t("common.test")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function LanguagePicker() {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{t("common.language")}</span>
        <Select value={i18n.language} onValueChange={setLanguage}>
          <SelectTrigger size="sm" className="w-auto bg-secondary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function StatusStrip() {
  const { t } = useTranslation();
  const { data } = useStatus();
  if (!data?.length) return null;
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {data.map((s) => (
        <div
          key={s.service}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-full bg-card px-3.5 py-2 text-xs font-semibold",
            !s.ok && "text-destructive",
          )}
        >
          <span className={cn("size-2 rounded-full", s.ok ? "bg-success" : "bg-destructive")} />
          {SERVICE_LABELS[s.service] ?? s.service}
          <span className="font-normal text-muted-foreground">
            {s.ok ? s.version : t("manage.offlineShort")}
          </span>
        </div>
      ))}
    </div>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function SecurityCard() {
  const { t } = useTranslation();
  const { data: auth, refetch } = useAuthState();
  const supported = passkeysSupported();
  const { data: passkeys } = usePasskeys(supported || (auth?.lan ?? false));
  const { data: setup } = useSetupCode((auth?.lan ?? false) || (auth?.authenticated ?? false));
  const deletePasskey = useDeletePasskey();
  const logout = useLogout();
  const signedIn = (auth?.lan ?? false) || (auth?.authenticated ?? false);
  const { data: sessions } = useSessions(signedIn);
  const revoke = useRevokeSessions();
  const [busy, setBusy] = useState(false);

  const addPasskey = async () => {
    setBusy(true);
    try {
      await registerPasskey(`passkey ${new Date().toISOString().slice(0, 10)}`);
      toast.success(t("auth.passkeys"));
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{t("auth.security")}</span>
          <div className="flex gap-1.5">
            {supported && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={addPasskey}>
                {t("auth.addPasskey")}
              </Button>
            )}
            {auth?.authenticated && (
              <Button
                size="sm"
                variant="secondary"
                className="text-destructive"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                {t("auth.signOut")}
              </Button>
            )}
          </div>
        </div>
        {!supported && (
          <span className="text-xs text-muted-foreground">{t("auth.needsHttps")}</span>
        )}
        {(passkeys ?? []).map((pk) => (
          <div key={pk.id} className="flex items-center justify-between text-sm">
            <span>
              {pk.name}{" "}
              <span className="text-xs text-muted-foreground">
                {new Date(pk.created * 1000).toLocaleDateString()}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={deletePasskey.isPending}
              aria-label={t("auth.deletePasskey", { name: pk.name })}
              onClick={() => deletePasskey.mutate(pk.id)}
            >
              ✕
            </Button>
          </div>
        ))}
        {passkeys && passkeys.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("auth.noPasskeys")}</span>
        )}
        {(sessions ?? []).length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{t("auth.sessions")}</Label>
              {(sessions ?? []).some((s) => !s.current) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(undefined, {
                      onSuccess: (r) =>
                        toast.success(t("auth.sessionsRevoked", { count: r?.revoked ?? 0 })),
                    })
                  }
                >
                  {t("auth.signOutOthers")}
                </Button>
              )}
            </div>
            {(sessions ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("auth.sessionSeen", { when: new Date(s.last_used * 1000).toLocaleString() })}
                  {s.current && ` · ${t("auth.thisDevice")}`}
                </span>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={revoke.isPending}
                    aria-label={t("auth.revokeSession")}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {setup && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("auth.setupCode")}</span>
            <span className="font-mono font-semibold tracking-[0.2em]">{setup.code}</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{t("auth.registerHint")}</span>
      </div>
    </Card>
  );
}

function EventToggles({ endpoint }: { endpoint: string }) {
  const { t } = useTranslation();
  const { data } = usePushEvents(true, endpoint);
  const save = useSavePushEvents();
  if (!data) return null;
  // With a subscription the chips edit this device alone; without one they set
  // the default that every unconfigured device follows.
  const current = save.variables?.enabled ?? data.device ?? data.enabled;
  const enabled = new Set(current);
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">
        {endpoint ? t("push.eventsThisDevice") : t("push.events")}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {data.available.map((event) => {
          const on = enabled.has(event.key);
          return (
            <button
              key={event.key}
              className={cn(
                focusRing,
                "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
              )}
              onClick={() =>
                save.mutate({
                  endpoint,
                  enabled: on
                    ? [...enabled].filter((k) => k !== event.key)
                    : [...enabled, event.key],
                })
              }
            >
              {t(`push.event.${event.key}`, event.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Quiet hours and tag filters. The browser supplies its own timezone, because
 * the container runs UTC and a window entered as 23:00 would otherwise take
 * effect at the wrong time of night. */
function NotificationRules() {
  const { t } = useTranslation();
  const { data } = usePushRules();
  const save = useSavePushRules();
  const radarrTags = useTags("radarr");
  const sonarrTags = useTags("sonarr");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  if (!data) return null;

  const quietStart = start ?? data.quiet_start ?? "";
  const quietEnd = end ?? data.quiet_end ?? "";
  const tags: Record<string, number[]> = data.tags ?? {};
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const persist = (over: Record<string, unknown>) =>
    save.mutate({
      quiet_start: quietStart,
      quiet_end: quietEnd,
      timezone: browserTz,
      tags: { radarr: tags.radarr ?? [], sonarr: tags.sonarr ?? [] },
      ...over,
    } as Parameters<typeof save.mutate>[0]);

  const toggleTag = (app: "radarr" | "sonarr", id: number) => {
    const current = tags[app] ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    persist({ tags: { radarr: tags.radarr ?? [], sonarr: tags.sonarr ?? [], [app]: next } });
  };

  const tagRows = ([["radarr", radarrTags.data], ["sonarr", sonarrTags.data]] as const).filter(
    ([, list]) => (list?.length ?? 0) > 0,
  );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">
        {t("push.quietHours")}
        {data.quiet_now ? ` · ${t("push.quietNow")}` : ""}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          type="time"
          className="w-28"
          value={quietStart}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => persist({ quiet_start: quietStart })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="time"
          className="w-28"
          value={quietEnd}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={() => persist({ quiet_end: quietEnd })}
        />
        {(quietStart || quietEnd) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStart("");
              setEnd("");
              persist({ quiet_start: "", quiet_end: "" });
            }}
          >
            {t("common.clear")}
          </Button>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {t("push.quietHint", { tz: data.timezone || browserTz })}
      </span>
      {tagRows.map(([app, list]) => (
        <div key={app} className="flex flex-wrap items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("push.onlyTags", { app: SERVICE_LABELS[app] ?? app })}
          </Label>
          {(list ?? []).map((tag) => {
            const on = (tags[app] ?? []).includes(tag.id);
            return (
              <button
                key={tag.id}
                className={cn(
                focusRing,
                  "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                  on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                )}
                onClick={() => toggleTag(app, tag.id)}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Radarr and Sonarr push events to arrdeck the moment they happen; without
 * this the backend falls back to polling their history every minute. */
function WebhookSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useWebhookStatus(true);
  const install = useInstallWebhooks();
  const [edited, setEdited] = useState<string | null>(null);
  const baseUrl = edited ?? data?.base_url ?? "";
  const connected = (data?.apps ?? []).some((a) => a.installed);

  const run = (remove?: boolean) =>
    install.mutate(
      { baseUrl, remove },
      {
        onSuccess: (rows) => {
          const failed = rows.filter((r) => r.error);
          if (failed.length === 0) {
            toast.success(remove ? t("push.hookRemoved") : t("push.hookConnected"));
            return;
          }
          for (const row of failed) {
            toast.error(`${SERVICE_LABELS[row.app] ?? row.app}: ${row.error}`);
          }
        },
      },
    );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">{t("push.delivery")}</Label>
      {isLoading ? (
        <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
      ) : (
        <>
          {(data?.apps ?? []).map((row) => (
            <div key={row.app} className="flex items-center justify-between text-sm">
              <span>{SERVICE_LABELS[row.app] ?? row.app}</span>
              <span
                className={cn(
                  "text-xs",
                  row.installed ? "text-success" : "text-muted-foreground",
                  row.error && "text-destructive",
                )}
              >
                {row.error
                  ? row.error
                  : !row.configured
                    ? t("manage.notConfigured")
                    : row.installed
                      ? t("push.hookOn")
                      : t("push.hookOff")}
              </span>
            </div>
          ))}
          <Input
            value={baseUrl}
            onChange={(e) => setEdited(e.target.value)}
            placeholder="http://10.0.0.154:3500"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button disabled={install.isPending || !baseUrl.trim()} onClick={() => run()}>
              {install.isPending
                ? t("common.saving")
                : connected
                  ? t("push.hookReconnect")
                  : t("push.hookConnect")}
            </Button>
            {connected && (
              <Button
                variant="secondary"
                className="text-destructive"
                disabled={install.isPending}
                onClick={() => run(true)}
              >
                {t("push.hookRemove")}
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{t("push.hookHint")}</span>
          {data?.last_event != null && (
            <span className="text-xs text-muted-foreground">
              {t("push.lastEvent", {
                when: new Date(data.last_event * 1000).toLocaleString(),
              })}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function NotificationsCard() {
  const { t } = useTranslation();
  const supported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const { data: vapid } = useVapidKey(supported);
  const pushApi = usePushSubscribe();
  const testPush = useTestPush();
  // "" when this device isn't subscribed — also what scopes the event chips
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = endpoint !== "";

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? ""))
      .catch(() => {});
  }, [supported]);

  const toggle = async () => {
    if (!vapid) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          pushApi.mutate({ subscription: sub.toJSON(), unsubscribe: true });
          await sub.unsubscribe();
        }
        setEndpoint("");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error(t("push.denied"));
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.key).buffer as ArrayBuffer,
        });
        pushApi.mutate({ subscription: sub.toJSON() });
        setEndpoint(sub.endpoint);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{t("push.title")}</span>
          {supported ? (
            <div className="flex gap-1.5">
              {enabled && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={testPush.isPending}
                  onClick={() =>
                    testPush.mutate(endpoint, {
                      onSuccess: () => toast.success(t("push.testSent")),
                    })
                  }
                >
                  {t("common.test")}
                </Button>
              )}
              <Button
                size="sm"
                variant={enabled ? "default" : "secondary"}
                disabled={busy || !vapid}
                onClick={toggle}
              >
                {enabled ? t("push.enabled") : t("push.enable")}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t("push.needsHttps")}</span>
          )}
        </div>
        <EventToggles endpoint={endpoint} />
        <NotificationRules />
        <WebhookSection />
      </div>
    </Card>
  );
}

/** Trakt lists, TMDB collections and the like. Hidden entirely when the arrs
 * have none configured, which is the default. */
function ImportLists() {
  const { t } = useTranslation();
  const { data } = useImportLists(true);
  const toggle = useToggleImportList();
  const sync = useSyncImportLists();
  if (!data || data.length === 0) return null;
  const apps = Array.from(new Set(data.map((l) => l.app)));
  return (
    <Card>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("manage.importLists")}</span>
          <div className="flex gap-1.5">
            {apps.map((app) => (
              <Button
                key={app}
                size="sm"
                variant="secondary"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(app, { onSuccess: () => toast.success(t("manage.syncStarted")) })
                }
              >
                {t("manage.syncApp", { app: SERVICE_LABELS[app] ?? app })}
              </Button>
            ))}
          </div>
        </div>
        {data.map((list) => (
          <div key={`${list.app}-${list.id}`} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{list.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[SERVICE_LABELS[list.app] ?? list.app, list.implementation, list.monitor]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <Button
              size="sm"
              variant={list.enabled ? "default" : "secondary"}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ app: list.app, id: list.id })}
            >
              {list.enabled ? t("manage.enabled") : t("manage.disabled")}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsTransfer() {
  const { t } = useTranslation();
  const importSettings = useImportSettings();
  const [busy, setBusy] = useState(false);

  const download = (data: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportSettings = async () => {
    download(await api.get("/settings/export"), "arrdeck-settings.json");
  };

  // the full snapshot carries passkey keys and the VAPID private key, so it is
  // a credential file — labelled separately from the plain settings export
  const exportBackup = async () => {
    setBusy(true);
    try {
      download(await api.get("/backup"), "arrdeck-backup.json");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File) => {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.version) {
        const counts = await api.post<Record<string, number>>("/restore", parsed);
        toast.success(
          t("manage.restored", {
            services: counts.services ?? 0,
            passkeys: counts.credentials ?? 0,
          }),
        );
      } else {
        // a settings-only export from before backups existed
        importSettings.mutate(parsed.services ?? parsed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportSettings}>
            {t("manage.export")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={exportBackup}>
            {t("manage.backup")}
          </Button>
          <Button variant="secondary" size="sm" asChild disabled={busy}>
            <label className="cursor-pointer">
              {t("manage.import")}
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) restore(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{t("manage.backupHint")}</span>
      </div>
    </Card>
  );
}

export function ServiceSettingsTab() {
  const { t } = useTranslation();
  const { data, error } = useServiceSettings();
  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  if (!data) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  return (
    <>
      <StatusStrip />
      <LanguagePicker />
      <SecurityCard />
      <NotificationsCard />
      <ImportLists />
      <SettingsTransfer />
      {Object.entries(data).map(([name, conf]) => (
        <ServiceSettingsCard
          key={`${name}-${conf.url}-${conf.api_key}`}
          name={name}
          initial={conf}
        />
      ))}
    </>
  );
}
