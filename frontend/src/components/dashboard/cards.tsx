// Status cards: playback, health, requests, storage, VPN, subtitles, trends.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBytes } from "../../api/format";

import {
  BlockView,
  Card,
  ProgressBar,
  Row,
  SectionTitle,
  StateBadge,
} from "../../components/Blocks";
import {
  useDiskSpace,
  useHealth,
  useMediaRequests,
  usePlaySessions,
  useRequestAction,
  useStatsHistory,
  useSubtitleSearch,
  useSubtitles,
  useVpn,
} from "../../hooks/queries";

export function NowPlayingSection({ configured }: { configured: Set<string> }) {
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

export function HealthSection({ configured }: { configured: Set<string> }) {
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

export function RequestsSection({ configured }: { configured: Set<string> }) {
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
                {r.title || `#${r.id}`}{" "}
                {r.year && <span className="text-muted-foreground">({r.year})</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={r.type === "tv" ? "sonarr" : "radarr"} />
                {r.requested_by}
                {(r.seasons?.length ?? 0) > 0 &&
                  ` · ${t("dash.seasonCount", { count: r.seasons!.length })}`}
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

export function StorageSection({ configured }: { configured: Set<string> }) {
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

export function VpnSection({ configured }: { configured: Set<string> }) {
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
                  {vpn.port_matches === false && <StateBadge state="warning" raw />}
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

export function SubtitlesSection({ configured }: { configured: Set<string> }) {
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
            {t("dash.subtitlesMissing", {
              movies: subs?.movies ?? 0,
              episodes: subs?.episodes ?? 0,
            })}
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
                search.mutate({
                  kind: item.kind as "movie" | "episode",
                  id: item.id,
                  series_id: item.series_id,
                })
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

export function TrendsSection() {
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
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="h-7 w-full text-primary">
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
