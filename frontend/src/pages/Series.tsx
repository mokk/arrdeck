import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RenameCard } from "../components/RenameCard";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDate } from "../api/format";
import type { Season } from "../api/types";
import { Card, ErrorNote, Row, StateBadge } from "../components/Blocks";
import { ReleasesSheet } from "../components/ReleasesSheet";
import {
  useEpisodeMonitor,
  useEpisodeSearch,
  useSeasonMonitor,
  useSeasonSearch,
  useSeriesDetail,
  useSeriesEpisodes,
} from "../hooks/queries";

type ReleaseTarget = { season?: number; episodeId?: number; title: string };

function EpisodeList({
  seriesId,
  season,
  onReleases,
}: {
  seriesId: number;
  season: number;
  onReleases: (target: ReleaseTarget) => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useSeriesEpisodes(seriesId, season);
  const monitor = useEpisodeMonitor(seriesId);
  const search = useEpisodeSearch();

  if (isLoading)
    return (
      <div className="px-4 py-2">
        <Skeleton className="mb-2 h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );

  return (
    <>
      {(data ?? []).map((e) => (
        <Row key={e.id} className="bg-background/40">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                E{String(e.episode).padStart(2, "0")}
              </span>{" "}
              {e.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {e.has_file ? (
                <StateBadge state="downloaded" />
              ) : (
                <StateBadge state={e.monitored ? "wanted" : "paused"} />
              )}
              {formatDate(e.air_date)}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={monitor.isPending}
              onClick={() => monitor.mutate({ ids: [e.id], monitored: !e.monitored })}
            >
              {e.monitored ? t("add.unmonitor") : t("add.monitor")}
            </Button>
            {!e.has_file && (
              <Button
                variant="ghost"
                size="sm"
                disabled={search.isPending}
                onClick={() => search.mutate([e.id])}
              >
                {t("common.search")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("releases.interactive")}
              onClick={() =>
                onReleases({
                  episodeId: e.id,
                  title: `E${String(e.episode).padStart(2, "0")} ${e.title ?? ""}`,
                })
              }
            >
              <ChevronRight />
            </Button>
          </div>
        </Row>
      ))}
    </>
  );
}

function SeasonCard({
  seriesId,
  season,
  onReleases,
}: {
  seriesId: number;
  season: Season;
  onReleases: (target: ReleaseTarget) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const monitor = useSeasonMonitor(seriesId);
  const search = useSeasonSearch(seriesId);
  const label =
    season.number === 0 ? t("series.specials") : t("series.season", { n: season.number });

  return (
    <Card>
      <Row onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1 select-none">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {label}
            {!season.monitored && <StateBadge state="unmonitored" />}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("series.episodes", {
              files: season.episode_file_count,
              total: season.episode_count,
            })}{" "}
            · {formatBytes(season.size_on_disk)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="sm"
            disabled={monitor.isPending}
            onClick={() =>
              monitor.mutate({ season: season.number, monitored: !season.monitored })
            }
          >
            {season.monitored ? t("add.unmonitor") : t("add.monitor")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={search.isPending}
            onClick={() => search.mutate(season.number)}
          >
            {t("common.search")}
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            title={t("releases.interactive")}
            onClick={() => onReleases({ season: season.number, title: label })}
          >
            <ChevronRight />
          </Button>
        </div>
      </Row>
      {open && (
        <EpisodeList seriesId={seriesId} season={season.number} onReleases={onReleases} />
      )}
    </Card>
  );
}

export default function SeriesPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const seriesId = Number(id);
  const navigate = useNavigate();
  const { data, error, isLoading } = useSeriesDetail(seriesId);
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);

  return (
    <>
      <div className="mb-4 mt-2 flex items-center gap-2.5">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </Button>
        {data?.poster && (
          <img
            src={data.poster}
            alt=""
            className="w-9 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
          />
        )}
        <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">
          {data?.title ?? "…"}
        </h1>
      </div>
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && (
        <>
          <Skeleton className="mb-3 h-16 w-full rounded-2xl" />
          <Skeleton className="mb-3 h-16 w-full rounded-2xl" />
        </>
      )}
      {data && <RenameCard app="sonarr" id={seriesId} />}
      {data?.seasons.map((s) => (
        <SeasonCard key={s.number} seriesId={seriesId} season={s} onReleases={setReleaseTarget} />
      ))}
      {releaseTarget && (
        <ReleasesSheet
          app="sonarr"
          params={{
            seriesId,
            season: releaseTarget.season,
            episodeId: releaseTarget.episodeId,
          }}
          title={`${data?.title ?? ""} — ${releaseTarget.title}`}
          onClose={() => setReleaseTarget(null)}
        />
      )}
    </>
  );
}
