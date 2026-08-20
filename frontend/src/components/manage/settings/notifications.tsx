// Push: enabling it, which events, quiet hours and the arr webhooks.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { cn, focusRing } from "@/lib/utils";

import { SERVICE_LABELS } from "../../../api/format";
import {
  useInstallWebhooks,
  usePushEvents,
  usePushRules,
  usePushSubscribe,
  useSavePushEvents,
  useSavePushRules,
  useTags,
  useTestPush,
  useVapidKey,
  useWebhookStatus,
} from "../../../hooks/queries";
import { Card } from "../../Blocks";

/* ---------------- services (connection settings) ---------------- */

const _SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
  radarr: ["url", "api_key"],
  sonarr: ["url", "api_key"],
  prowlarr: ["url", "api_key"],
  overseerr: ["url", "api_key"],
  qbittorrent: ["url", "username", "password"],
  transmission: ["url"],
  gluetun: ["url", "api_key"],
  bazarr: ["url", "api_key"],
  plex: ["url", "api_key"],
  prometheus: ["url"],
};

const _FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
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
              type="button"
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

  const tagRows = (
    [
      ["radarr", radarrTags.data],
      ["sonarr", sonarrTags.data],
    ] as const
  ).filter(([, list]) => (list?.length ?? 0) > 0);

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
                type="button"
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

export function NotificationsCard() {
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
