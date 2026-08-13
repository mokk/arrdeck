import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  SERVICE_LABELS,
  formatBytes,
  formatDate,
  formatDateTime,
  formatSpeed,
} from "../api/format";
import type { CalendarItem, HistoryItem, Torrent } from "../api/types";
import {
  BlockView,
  Card,
  EmptyNote,
  ErrorNote,
  ProgressBar,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import {
  useBlocklistRetry,
  useCalendar,
  useHistory,
  useIndexerStats,
  useQueue,
  useServices,
  useStatsHistory,
  useTorrents,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

function TorrentSummary({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useTorrents();
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>(
    "dashboard.torrentsCollapsed",
    {},
  );

  const active = (list: Torrent[]) =>
    list.filter(
      (torrent) =>
        torrent.state === "downloading" || torrent.dl_speed > 0 || torrent.ul_speed > 0,
    );

  const clients = (["qbittorrent", "transmission"] as const).filter((c) =>
    configured.has(c),
  );
  if (clients.length === 0) return null;

  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.torrentActivity")}</SectionTitle>
      <Card>
        {clients.map((client) => (
          <div key={client}>
            <BlockView block={data?.[client]}>
              {(group) => (
                <>
                  <Row
                    onClick={() =>
                      setCollapsed({ ...collapsed, [client]: !collapsed[client] })
                    }
                  >
                    <div className="min-w-0 flex-1 select-none">
                      <div
                        className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground"
                        title={t("dash.speedTooltip")}
                      >
                        <span className="font-semibold text-foreground">
                          {collapsed[client] ? "▸" : "▾"} {SERVICE_LABELS[client]}
                        </span>
                        <span>
                          ↓ <b className="text-foreground">{formatSpeed(group.totals.dl_speed)}</b>
                        </span>
                        <span>
                          ↑ <b className="text-foreground">{formatSpeed(group.totals.ul_speed)}</b>
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("dash.torrentCount", {
                          count: group.torrents.length,
                          active: active(group.torrents).length,
                        })}
                      </div>
                    </div>
                  </Row>
                  {!collapsed[client] &&
                    active(group.torrents)
                      .slice(0, 5)
                      .map((torrent) => (
                        <Row key={torrent.id}>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{torrent.name}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <StateBadge state={torrent.state} /> ↓{formatSpeed(torrent.dl_speed)} ↑
                              {formatSpeed(torrent.ul_speed)}
                            </div>
                            <ProgressBar value={torrent.progress} />
                          </div>
                        </Row>
                      ))}
                </>
              )}
            </BlockView>
          </div>
        ))}
      </Card>
    </div>
  );
}

function QueueSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useQueue();
  const retry = useBlocklistRetry();
  const items = [...(data?.radarr?.data ?? []), ...(data?.sonarr?.data ?? [])];
  const offline = (["radarr", "sonarr"] as const).filter(
    (app) => configured.has(app) && data?.[app] && !data[app].ok,
  );
  if (items.length === 0 && offline.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.downloadQueue")}</SectionTitle>
      <Card>
        {offline.map((app) => (
          <ErrorNote key={app}>
            {t("dash.serviceOffline", { service: SERVICE_LABELS[app], error: data?.[app]?.error })}
          </ErrorNote>
        ))}
        {items.map((q) => (
          <Row key={`${q.app}-${q.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{q.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={q.app} />
                <StateBadge state={(q.errors ?? []).length ? "error" : q.status} />
                {q.time_left ?? ""}
              </div>
              <ProgressBar value={q.size ? (q.size - q.size_left) / q.size : 0} />
            </div>
            {(q.errors ?? []).length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 text-warning"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ app: q.app, id: q.id })}
              >
                {t("dl.blocklistRetry")}
              </Button>
            )}
          </Row>
        ))}
      </Card>
    </div>
  );
}

function CalendarSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useCalendar();
  const merged: CalendarItem[] = [
    ...(data?.radarr?.data ?? []),
    ...(data?.sonarr?.data ?? []),
  ].sort((a, b) => {
    if (a.date == null && b.date == null) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    return a.date.localeCompare(b.date);
  });

  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.upcoming")}</SectionTitle>
      <Card>
        {(["radarr", "sonarr"] as const).map((app) => {
          const block = data?.[app];
          return configured.has(app) && block && !block.ok ? (
            <ErrorNote key={app}>
              {t("dash.serviceOffline", { service: SERVICE_LABELS[app], error: block.error })}
            </ErrorNote>
          ) : null;
        })}
        {merged.length === 0 && <EmptyNote>{t("dash.nothingScheduled")}</EmptyNote>}
        {merged.slice(0, 15).map((c, i) => (
          <Row key={i}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={c.app} /> {c.extra ?? ""}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {c.has_file ? <StateBadge state="downloaded" /> : formatDate(c.date)}
            </div>
          </Row>
        ))}
      </Card>
    </div>
  );
}

function HistorySection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useHistory();
  const merged: HistoryItem[] = [
    ...(data?.radarr?.data ?? []),
    ...(data?.sonarr?.data ?? []),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t("dash.recentHistory")}</SectionTitle>
        <Link to="/history" className="mb-2 text-xs font-semibold text-primary">
          {t("history.seeAll")} →
        </Link>
      </div>
      <Card>
        {(["radarr", "sonarr"] as const).map((app) => {
          const block = data?.[app];
          return configured.has(app) && block && !block.ok ? (
            <ErrorNote key={app}>
              {t("dash.serviceOffline", { service: SERVICE_LABELS[app], error: block.error })}
            </ErrorNote>
          ) : null;
        })}
        {merged.slice(0, 12).map((h, i) => (
          <Row key={i}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{h.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                <StateBadge state={h.app} />
                {(h.events ?? []).map((e) => (
                  <span key={e.type} title={formatDateTime(e.date)}>
                    <StateBadge state={e.type} />
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(h.date)}
            </div>
          </Row>
        ))}
      </Card>
    </div>
  );
}

function IndexerSection() {
  const { t } = useTranslation();
  const { data } = useIndexerStats();
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.indexers")}</SectionTitle>
      <Card>
        <BlockView block={data}>
          {(stats) => (
            <>
              <Row>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    <b className="text-foreground">{stats.enabled}</b>/{stats.total}{" "}
                    {t("manage.enabled")}
                  </span>
                  {stats.health.map((h, i) => (
                    <span key={i} title={h.message ?? undefined}>
                      <StateBadge state="warning" raw />
                    </span>
                  ))}
                </div>
              </Row>
              {stats.stats.map((s) => (
                <Row key={s.name}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("dash.queriesGrabs", { queries: s.queries, grabs: s.grabs })}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {s.avg_response_ms} ms
                  </div>
                </Row>
              ))}
            </>
          )}
        </BlockView>
      </Card>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 110;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full text-primary">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendsSection() {
  const { t } = useTranslation();
  const { data } = useStatsHistory(30);
  if (!data || data.length < 2) return null;

  const last = data[data.length - 1];
  const tiles = [
    {
      label: t("dash.librarySize"),
      value: formatBytes(last.library_bytes),
      values: data.map((s) => s.library_bytes ?? 0),
    },
    {
      label: t("dash.movies"),
      value: String(last.movies),
      values: data.map((s) => s.movies ?? 0),
    },
    {
      label: t("dash.seriesCount"),
      value: String(last.series),
      values: data.map((s) => s.series ?? 0),
    },
    {
      label: t("dash.grabs"),
      value: String(last.indexer_grabs),
      values: data.map((s) => s.indexer_grabs ?? 0),
    },
  ];

  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.trends")}</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl bg-card p-3.5">
            <div className="text-xs text-muted-foreground">{tile.label}</div>
            <div className="mb-1 text-lg font-bold">{tile.value}</div>
            <Sparkline values={tile.values} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const hasArr = configured.has("radarr") || configured.has("sonarr");
  return (
    <>
      <TorrentSummary configured={configured} />
      {hasArr && <QueueSection configured={configured} />}
      {hasArr && <CalendarSection configured={configured} />}
      {hasArr && <HistorySection configured={configured} />}
      {configured.has("prowlarr") && <IndexerSection />}
      <TrendsSection />
    </>
  );
}
