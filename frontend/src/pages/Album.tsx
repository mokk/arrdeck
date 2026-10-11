import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDay } from "../api/format";
import type { AlbumDetail, AlbumTrack } from "../api/types";
import { Card, ErrorNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import { useConfirm } from "../components/Confirm";
import { DetailHeader, DetailHero, DetailHistory } from "../components/detail";
import { albumState, formatDuration, musicLinks } from "../components/library/music";
import { BigButton } from "../components/media";
import { ReleasesSheet } from "../components/ReleasesSheet";
import {
  useAlbumDetail,
  useDeleteTrackFiles,
  useMonitorAlbum,
  useTriggerSearch,
} from "../hooks/queries";

/** The tracks of each disc or side, under its own heading when there is
 * more than one. */
function byMedium(
  album: AlbumDetail,
): { number: number; label: string; tracks: AlbumTrack[] }[] {
  const media = new Map<number, AlbumTrack[]>();
  for (const track of album.tracks ?? []) {
    const n = track.medium ?? 1;
    media.set(n, [...(media.get(n) ?? []), track]);
  }
  return [...media.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, tracks]) => {
      const medium = (album.media ?? []).find((m) => m.number === number);
      return {
        number,
        label: [medium?.format, medium?.name].filter(Boolean).join(" · "),
        tracks,
      };
    });
}

/** One album: its tracks and which are on disk, in what quality, the
 * searches, and the files. Its quality profile is the artist's. */
export default function AlbumPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const albumId = Number(id);
  const confirm = useConfirm();
  const { data, error, isLoading } = useAlbumDetail(albumId);
  const monitor = useMonitorAlbum();
  const search = useTriggerSearch();
  const deleteFiles = useDeleteTrackFiles(albumId);
  const [showReleases, setShowReleases] = useState(false);

  const media = data ? byMedium(data) : [];
  const busy = monitor.isPending || search.isPending || deleteFiles.isPending;

  return (
    <>
      <DetailHeader title={data?.title} year={data?.year} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && (
        <>
          <DetailHero
            poster={data.poster}
            backdrop={data.poster}
            blurBackdrop
            square
            overview={data.overview}
            ratings={data.ratings}
            links={musicLinks("release-group", data.slug, data.links)}
            badges={
              <>
                <StateBadge state={albumState(data)} />
                {data.artist &&
                  (data.artist_id ? (
                    <Link to={`/artist/${data.artist_id}`} className="text-primary">
                      {data.artist}
                    </Link>
                  ) : (
                    <span>{data.artist}</span>
                  ))}
                {/* Lidarr's own word for it: Album, EP, Single… */}
                {data.album_type && <span>· {data.album_type}</span>}
                {(data.secondary_types ?? []).map((type) => (
                  <span key={type}>· {type}</span>
                ))}
                {data.release_date && data.year && (
                  <span>· {formatDay(data.release_date)}</span>
                )}
              </>
            }
          />

          <div className="mb-5">
            <BigButton
              color="blue"
              disabled={busy}
              onClick={async () => {
                const action = data.monitored ? t("add.unmonitor") : t("add.monitor");
                if (await confirm({ action, subject: data.title }))
                  monitor.mutate({ id: albumId, monitored: !data.monitored });
              }}
            >
              {data.monitored ? t("add.unmonitor") : t("add.monitor")}
            </BigButton>
            <BigButton
              color="blue"
              disabled={busy}
              onClick={async () => {
                if (await confirm({ action: t("add.searchNow"), subject: data.title }))
                  search.mutate({ app: "lidarr", id: albumId });
              }}
            >
              {t("add.searchNow")}
            </BigButton>
            <BigButton color="blue" onClick={() => setShowReleases(true)}>
              {t("releases.interactive")}
            </BigButton>
            {(data.track_file_count ?? 0) > 0 && (
              <BigButton
                color="red"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    action: t("album.deleteFiles"),
                    subject: data.title,
                    destructive: true,
                  });
                  if (ok) deleteFiles.mutate(undefined);
                }}
              >
                {t("album.deleteFiles")}
              </BigButton>
            )}
          </div>

          <SectionTitle>
            {t("album.tracks", {
              have: data.track_file_count ?? 0,
              total: data.track_count ?? 0,
            })}
          </SectionTitle>
          {media.map((medium) => (
            <div key={medium.number}>
              {media.length > 1 && (
                <div className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">
                  {t("album.medium", { number: medium.number })}
                  {medium.label ? ` · ${medium.label}` : ""}
                </div>
              )}
              <Card className="mb-3">
                {medium.tracks.map((track) => (
                  <Row key={track.id}>
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                      {track.number ?? track.absolute}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{track.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <StateBadge
                          state={
                            track.has_file
                              ? "downloaded"
                              : data.monitored
                                ? "wanted"
                                : "unmonitored"
                          }
                        />
                        {formatDuration(track.duration)}
                        {track.has_file && (track.quality || track.size) ? (
                          <span>
                            ·{" "}
                            {[track.quality, track.size ? formatBytes(track.size) : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {track.file_id != null && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={t("album.deleteTrackFile", { title: track.title ?? "" })}
                        title={t("episode.deleteFile")}
                        disabled={deleteFiles.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            action: t("episode.deleteFile"),
                            subject: track.title,
                            destructive: true,
                          });
                          if (ok) deleteFiles.mutate(track.file_id!);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </Row>
                ))}
              </Card>
            </div>
          ))}

          <div className="mb-4 px-1 text-xs text-muted-foreground">
            {[
              data.release,
              formatDuration(data.duration),
              data.size_on_disk ? formatBytes(data.size_on_disk) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>

          {(data.genres?.length ?? 0) > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {(data.genres ?? []).slice(0, 8).map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          <DetailHistory history={data.history} />
        </>
      )}
      {showReleases && (
        <ReleasesSheet
          app="lidarr"
          params={{ albumId }}
          title={data ? `${data.artist ?? ""} — ${data.title}` : ""}
          onClose={() => setShowReleases(false)}
        />
      )}
    </>
  );
}
