// What the stack is doing: recent adds, transfers, queue, calendar, history.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { clickable } from "@/lib/utils";
import { formatDate, formatDateTime, formatSpeed, SERVICE_LABELS } from "../../api/format";
import type { CalendarItem, HistoryItem } from "../../api/types";
import {
  BlockView,
  Card,
  EmptyNote,
  ErrorNote,
  ProgressBar,
  Row,
  SectionTitle,
  StateBadge,
} from "../../components/Blocks";
import { ImportSheet } from "../../components/ImportSheet";
import {
  useBlocklistRetry,
  useCalendar,
  useForceImport,
  useHistory,
  useIndexerStats,
  useQueue,
  useRecent,
  useTorrentsSummary,
} from "../../hooks/queries";
import { usePersistentState } from "../../hooks/usePersistentState";

export function RecentSection() {
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
            {...clickable(() =>
              r.library_id
                ? navigate(
                    r.app === "sonarr" ? `/series/${r.library_id}` : `/movie/${r.library_id}`,
                  )
                : undefined,
            )}
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

export function TorrentSummary({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useTorrentsSummary();
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>(
    "dashboard.torrentsCollapsed",
    {},
  );

  const clients = (["qbittorrent", "transmission"] as const).filter((c) => configured.has(c));
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
                    onClick={() => setCollapsed({ ...collapsed, [client]: !collapsed[client] })}
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
                          ↓{" "}
                          <b className="text-foreground">
                            {formatSpeed(group.totals.dl_speed)}
                          </b>
                        </span>
                        <span>
                          ↑{" "}
                          <b className="text-foreground">
                            {formatSpeed(group.totals.ul_speed)}
                          </b>
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
                            <StateBadge state={torrent.state} /> ↓
                            {formatSpeed(torrent.dl_speed)} ↑{formatSpeed(torrent.ul_speed)}
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

export function QueueSection({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const { data } = useQueue();
  const retry = useBlocklistRetry();
  const forceImport = useForceImport();
  const [importing, setImporting] = useState<{ app: string; id: number } | null>(null);
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
            {t("dash.serviceOffline", {
              service: SERVICE_LABELS[app],
              error: data?.[app]?.error,
            })}
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
              {/* the arr couldn't place the files itself — go look at why */}
              {(q.tracked_status === "warning" || q.tracked_status === "error") && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setImporting({ app: q.app, id: q.id })}
                >
                  {t("dl.manualImport")}
                </Button>
              )}
            </div>
          </Row>
        ))}
      </Card>
      {importing && (
        <ImportSheet
          app={importing.app}
          itemId={importing.id}
          onClose={() => setImporting(null)}
        />
      )}
    </div>
  );
}

export function CalendarSection({ configured }: { configured: Set<string> }) {
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

export function HistorySection({ configured }: { configured: Set<string> }) {
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

export function IndexerSection() {
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
