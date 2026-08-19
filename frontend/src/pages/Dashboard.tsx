import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
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
  useDiskSpace,
  useHealth,
  useMediaRequests,
  useVpn,
  useSubtitles,
  usePlaySessions,
  useSubtitleSearch,
  useRequestAction,
  useCalendar,
  useForceImport,
  useHistory,
  useIndexerStats,
  useQueue,
  useRecent,
  useSearch,
  useServices,
  useStatsHistory,
  useTorrents,
  useTorrentsSummary,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";
import { PosterGrid } from "../components/media";
import { useRegisterSearchbar } from "../components/subnav";
import type { SearchResult } from "../api/types";

function RecentSection() {
  const { t } = useTranslation();
  const { data } = useRecent();
  const navigate = useNavigate();
  if (!data?.length) return null;
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t("dash.recentlyAdded")}</SectionTitle>
        <Link to="/wanted" className="mb-2 text-xs font-semibold text-primary">
          {t("dash.wanted")} →
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
        {data.map((r, i) => (
          <div
            key={i}
            className="w-[92px] shrink-0 cursor-pointer active:opacity-70"
            onClick={() =>
              r.library_id &&
              navigate(r.app === "sonarr" ? `/series/${r.library_id}` : `/movie/${r.library_id}`)
            }
          >
            {r.poster ? (
              <img
                src={r.poster}
                alt=""
                loading="lazy"
                className="w-full rounded-xl bg-card object-cover [aspect-ratio:2/3]"
              />
            ) : (
              <div className="flex w-full items-center justify-center rounded-xl bg-card p-1 text-center text-[0.65rem] text-muted-foreground [aspect-ratio:2/3]">
                {r.title}
              </div>
            )}
            <div className="mt-1 truncate text-[0.7rem] font-semibold">{r.title}</div>
            <div className="truncate text-[0.65rem] text-muted-foreground">
              {r.subtitle ?? ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TorrentSummary({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useTorrentsSummary();
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>(
    "dashboard.torrentsCollapsed",
    {},
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
                          count: group.count,
                          active: group.active_count,
                        })}
                      </div>
                    </div>
                  </Row>
                  {!collapsed[client] &&
                    (group.active ?? []).map((torrent) => (
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

/** Only rendered when something is actually wrong — a permanently visible
 * "all good" card trains you to stop reading it. */
function HealthSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasArr = configured.has("radarr") || configured.has("sonarr");
  const { data } = useHealth(hasArr);
  const warnings = data?.data ?? [];
  if (!hasArr || warnings.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.health")}</SectionTitle>
      <Card>
        {warnings.map((w, i) => (
          <Row key={`${w.app}-${i}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <StateBadge state={w.app} />
                <StateBadge state={w.level === "error" ? "error" : "warning"} />
              </div>
              <div className="mt-1 text-sm">{w.message}</div>
            </div>
          </Row>
        ))}
      </Card>
    </div>
  );
}

/** Pending Overseerr requests, with the approve/deny that would otherwise mean
 * opening Overseerr. Hidden when the queue is empty. */
function RequestsSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasOverseerr = configured.has("overseerr");
  const { data } = useMediaRequests(hasOverseerr);
  const act = useRequestAction();
  const requests = data?.data ?? [];
  if (!hasOverseerr || requests.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.requests")}</SectionTitle>
      <Card>
        {requests.map((r) => (
          <Row key={r.id}>
            {r.poster && (
              <img
                src={r.poster}
                alt=""
                className="h-16 w-11 shrink-0 rounded-lg object-cover"
                loading="lazy"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {r.title || `#${r.id}`} {r.year && <span className="text-muted-foreground">({r.year})</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={r.type === "tv" ? "sonarr" : "radarr"} />
                {r.requested_by}
                {(r.seasons?.length ?? 0) > 0 && ` · ${t("dash.seasonCount", { count: r.seasons!.length })}`}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="text-success"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: r.id, action: "approve" })}
              >
                {t("dash.approve")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-destructive"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: r.id, action: "decline" })}
              >
                {t("dash.decline")}
              </Button>
            </div>
          </Row>
        ))}
      </Card>
    </div>
  );
}

/** Live playback. Sits at the top when something is on, and disappears
 * entirely otherwise rather than showing an empty card. */
function NowPlayingSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasPlex = configured.has("plex");
  const { data } = usePlaySessions(hasPlex);
  const sessions = data?.data ?? [];
  if (!hasPlex || sessions.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.nowPlaying")}</SectionTitle>
      <Card>
        {sessions.map((s, i) => (
          <Row key={`${s.user}-${s.title}-${i}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.title}</div>
              {s.subtitle && (
                <div className="truncate text-xs text-muted-foreground">{s.subtitle}</div>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={s.state === "paused" ? "paused" : "downloading"} raw />
                {s.user}
                {s.player && ` · ${s.player}`}
                {s.transcoding && ` · ${t("dash.transcoding")}`}
              </div>
              <ProgressBar value={s.progress ?? 0} />
            </div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0">
                <Button size="sm" variant="secondary">
                  {t("dash.openInPlex")}
                </Button>
              </a>
            )}
          </Row>
        ))}
      </Card>
    </div>
  );
}

function SubtitlesSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasBazarr = configured.has("bazarr");
  const { data } = useSubtitles(hasBazarr);
  const search = useSubtitleSearch();
  const subs = data?.data;
  const total = (subs?.episodes ?? 0) + (subs?.movies ?? 0);
  if (!hasBazarr || total === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.subtitles")}</SectionTitle>
      <Card>
        <Row>
          <div className="flex-1 text-sm text-muted-foreground">
            {t("dash.subtitlesMissing", { movies: subs?.movies ?? 0, episodes: subs?.episodes ?? 0 })}
          </div>
          {/* no providers means every search is guaranteed to come back empty */}
          {subs?.providers === 0 && (
            <span className="text-xs text-warning">{t("dash.noProviders")}</span>
          )}
        </Row>
        {(subs?.items ?? []).slice(0, 8).map((item) => (
          <Row key={`${item.kind}-${item.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{item.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={item.kind === "episode" ? "sonarr" : "radarr"} />
                {item.subtitle}
                {(item.missing?.length ?? 0) > 0 && ` · ${item.missing!.join(", ")}`}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={search.isPending}
              onClick={() =>
                search.mutate({ kind: item.kind as "movie" | "episode", id: item.id, series_id: item.series_id })
              }
            >
              {t("dash.searchSubs")}
            </Button>
          </Row>
        ))}
      </Card>
    </div>
  );
}

function VpnSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasGluetun = configured.has("gluetun");
  const { data } = useVpn(hasGluetun);
  if (!hasGluetun) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.vpn")}</SectionTitle>
      <Card>
        <BlockView block={data}>
          {(vpn) => (
            <Row>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <StateBadge state={vpn.status === "running" ? "ok" : "error"} raw />
                  <span className="truncate text-sm font-medium">{vpn.public_ip || "—"}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[vpn.city, vpn.country].filter(Boolean).join(", ")}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {t("dash.forwardedPort", { port: vpn.forwarded_port ?? "—" })}
                  </span>
                  {/* a forwarded port the client isn't listening on is
                      silently unconnectable — worth calling out */}
                  {vpn.port_matches === false && (
                    <StateBadge state="warning" raw />
                  )}
                  {vpn.port_matches === false && (
                    <span className="text-warning">
                      {t("dash.portMismatch", { port: vpn.client_port ?? "—" })}
                    </span>
                  )}
                </div>
              </div>
            </Row>
          )}
        </BlockView>
      </Card>
    </div>
  );
}

function StorageSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const hasArr = configured.has("radarr") || configured.has("sonarr");
  const { data } = useDiskSpace(hasArr);
  if (!hasArr) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dash.storage")}</SectionTitle>
      <Card>
        <BlockView block={data}>
          {(disks) =>
            disks.map((d) => {
              const free = d.free_bytes ?? 0;
              const total = d.total_bytes ?? 0;
              // root folders don't report a total, so a bar is only honest
              // when a matching mount supplied one
              const used = total ? (total - free) / total : null;
              return (
                <Row key={d.path}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-xs">{d.path}</span>
                      <span className="shrink-0 text-sm font-semibold">
                        {t("dash.freeSpace", { size: formatBytes(free) })}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StateBadge state={d.label ?? ""} />
                      {total > 0 && formatBytes(total)}
                    </div>
                    {used != null && <ProgressBar value={used} />}
                  </div>
                </Row>
              );
            })
          }
        </BlockView>
      </Card>
    </div>
  );
}

function QueueSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useQueue();
  const retry = useBlocklistRetry();
  const forceImport = useForceImport();
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
                <StateBadge
                  state={
                    (q.errors ?? []).length || q.tracked_status === "error"
                      ? "error"
                      : q.tracked_status === "warning"
                        ? "warning"
                        : q.status
                  }
                />
                {q.time_left ?? ""}
              </div>
              <ProgressBar value={q.size ? (q.size - q.size_left) / q.size : 0} />
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              {q.tracked_state?.startsWith("import") && q.tracked_state !== "imported" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-primary"
                  disabled={forceImport.isPending}
                  onClick={() => forceImport.mutate({ app: q.app, id: q.id })}
                >
                  {t("dl.forceImport")}
                </Button>
              )}
              {((q.errors ?? []).length > 0 ||
                q.tracked_status === "warning" ||
                q.tracked_status === "error") && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-warning"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ app: q.app, id: q.id })}
                >
                  {t("dl.blocklistRetry")}
                </Button>
              )}
            </div>
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
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t("dash.upcoming")}</SectionTitle>
        <Link to="/calendar" className="mb-2 text-xs font-semibold text-primary">
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
        {merged.length === 0 && <EmptyNote>{t("dash.nothingScheduled")}</EmptyNote>}
        {merged.slice(0, 15).map((c, i) => (
          <Row key={i}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={c.app} />
                {c.release_type && <StateBadge state={t(`cal.${c.release_type}`)} raw />}
                {c.extra ?? ""}
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
  const navigate = useNavigate();
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
          <Row
            key={i}
            onClick={
              h.movie_id
                ? () => navigate(`/movie/${h.movie_id}`)
                : h.series_id
                  ? () => navigate(`/series/${h.series_id}`)
                  : undefined
            }
          >
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
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t("dash.trends")}</SectionTitle>
        <Link to="/stats" className="mb-2 text-xs font-semibold text-primary">
          {t("history.seeAll")} →
        </Link>
      </div>
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

function GlobalSearch({ query }: { query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const movies = useSearch("movies", query);
  const series = useSearch("series", query);
  const { data: torrentsData } = useTorrents();

  const torrentMatches = useMemo(() => {
    const needle = query.toLowerCase();
    const all = [
      ...(torrentsData?.qbittorrent?.data?.torrents ?? []),
      ...(torrentsData?.transmission?.data?.torrents ?? []),
    ];
    return all.filter((tor) => tor.name.toLowerCase().includes(needle)).slice(0, 15);
  }, [torrentsData, query]);

  const movieResults = (movies.data ?? []) as SearchResult[];
  const seriesResults = (series.data ?? []) as SearchResult[];
  const empty =
    !movies.isFetching &&
    !series.isFetching &&
    movieResults.length === 0 &&
    seriesResults.length === 0 &&
    torrentMatches.length === 0;

  return (
    <>
      {movieResults.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.movies")}</SectionTitle>
          <PosterGrid results={movieResults.slice(0, 12)} />
        </div>
      )}
      {seriesResults.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.series")}</SectionTitle>
          <PosterGrid results={seriesResults.slice(0, 12)} />
        </div>
      )}
      {torrentMatches.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.torrents")}</SectionTitle>
          <Card>
            {torrentMatches.map((tor) => (
              <Row
                key={`${tor.client}-${tor.id}`}
                onClick={() => {
                  localStorage.setItem("downloads.name", JSON.stringify(query));
                  navigate("/downloads");
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{tor.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <StateBadge state={tor.state} /> {SERVICE_LABELS[tor.client]}
                  </div>
                </div>
              </Row>
            ))}
          </Card>
        </div>
      )}
      {empty && <EmptyNote>{t("search.none")}</EmptyNote>}
    </>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(input), 450);
    return () => clearTimeout(id);
  }, [input]);
  useRegisterSearchbar(t("search.global"), input, setInput, undefined, () => {
    setInput("");
    setQuery("");
  });

  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const hasArr = configured.has("radarr") || configured.has("sonarr");
  if (query.trim().length > 1) return <GlobalSearch query={query} />;
  return (
    <>
      <NowPlayingSection configured={configured} />
      <HealthSection configured={configured} />
      <RequestsSection configured={configured} />
      <RecentSection />
      <TorrentSummary configured={configured} />
      {hasArr && <QueueSection configured={configured} />}
      <div className="lg:columns-2 lg:gap-5 [&>div]:break-inside-avoid">
        <StorageSection configured={configured} />
        <VpnSection configured={configured} />
        <SubtitlesSection configured={configured} />
        {hasArr && <CalendarSection configured={configured} />}
        {hasArr && <HistorySection configured={configured} />}
        {configured.has("prowlarr") && <IndexerSection />}
        <TrendsSection />
      </div>
    </>
  );
}
