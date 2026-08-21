import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDay, watchedFor } from "../api/format";
import type { Season } from "../api/types";
import { Card, ErrorNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import {
  DetailActions,
  DetailHeader,
  DetailHero,
  DetailProfileSelect,
  type ExternalLink,
} from "../components/detail";
import { ReleasesSheet } from "../components/ReleasesSheet";
import { RenameCard } from "../components/RenameCard";
import {
  useDeleteLibraryItem,
  useEpisodeMonitor,
  useEpisodeSearch,
  useOptions,
  useSeasonMonitor,
  useSeasonSearch,
  useSeriesDetail,
  useSeriesEpisodes,
  useServices,
  useTriggerSearch,
  useUpdateLibraryItem,
  useWatched,
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
              {formatDay(e.air_date)}
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
              aria-label={t("releases.interactive")}
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
            aria-label={t("releases.interactive")}
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
  const { data: options } = useOptions("sonarr");
  const { data: services } = useServices();
  const { data: watchedMap } = useWatched(
    (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const update = useUpdateLibraryItem("series");
  const remove = useDeleteLibraryItem("series");
  const search = useTriggerSearch();
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const watched = watchedFor(watchedMap?.data, {
    tvdb_id: data?.tvdb_id,
    tmdb_id: data?.tmdb_id,
    imdb_id: data?.imdb_id,
  });

  const links: ExternalLink[] = [];
  if (watched?.url) links.push({ label: "Plex", url: watched.url });
  if (data?.imdb_id)
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${data.imdb_id}/` });
  if (data?.tvdb_id)
    links.push({
      label: "TVDB",
      url: `https://www.thetvdb.com/dereferrer/series/${data.tvdb_id}`,
    });
  if (data?.tmdb_id)
    links.push({ label: "TMDB", url: `https://www.themoviedb.org/tv/${data.tmdb_id}` });

  return (
    <>
      <DetailHeader title={data?.title} year={data?.year} watched={watched} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && (
        <>
          <Skeleton className="mb-3 h-16 w-full rounded-2xl" />
          <Skeleton className="mb-3 h-16 w-full rounded-2xl" />
        </>
      )}
      {data && <RenameCard app="sonarr" id={seriesId} />}
      {data && (
        <>
          <DetailHero
            poster={data.poster}
            overview={data.overview}
            links={links}
            badges={
              <>
                <StateBadge state={data.monitored ? "ok" : "unmonitored"} />
                {data.status && <span className="capitalize">{data.status}</span>}
                {data.network && <span>· {data.network}</span>}
                {data.runtime ? (
                  <span>· {t("series.perEpisode", { min: data.runtime })}</span>
                ) : null}
                {data.certification && <span>· {data.certification}</span>}
              </>
            }
          />

          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <DetailProfileSelect
                value={data.quality_profile_id}
                options={options}
                disabled={update.isPending}
                onChange={(id) => update.mutate({ id: seriesId, quality_profile_id: id })}
              />
            </div>
            <DetailActions
              monitored={data.monitored ?? false}
              busy={update.isPending || remove.isPending || search.isPending}
              confirming={confirmingDelete}
              onConfirmingChange={setConfirmingDelete}
              onToggleMonitor={() =>
                update.mutate({ id: seriesId, monitored: !data.monitored })
              }
              onSearch={() => search.mutate({ app: "sonarr", id: seriesId })}
              onDelete={(deleteFiles) =>
                remove.mutate({ id: seriesId, deleteFiles }, { onSuccess: () => navigate(-1) })
              }
            />
          </div>

          {/* A series has no single file, so the movie page's file card becomes
              the ratio of episodes on disk. total_episode_count includes unaired
              ones, which is why it is shown separately rather than as the
              denominator. */}
          <SectionTitle>{t("series.onDisk")}</SectionTitle>
          <Card>
            <Row>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t("series.episodes", {
                    files: data.episode_file_count,
                    total: data.episode_count,
                  })}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatBytes(data.size_on_disk)}
                  {data.season_count
                    ? ` · ${t("series.seasonCount", { count: data.season_count })}`
                    : ""}
                  {(data.total_episode_count ?? 0) > (data.episode_count ?? 0)
                    ? ` · ${t("series.totalEpisodes", { count: data.total_episode_count })}`
                    : ""}
                </div>
              </div>
            </Row>
          </Card>

          <SectionTitle>{t("series.seasons")}</SectionTitle>
          {data.seasons.map((s) => (
            <SeasonCard
              key={s.number}
              seriesId={seriesId}
              season={s}
              onReleases={setReleaseTarget}
            />
          ))}
        </>
      )}
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
