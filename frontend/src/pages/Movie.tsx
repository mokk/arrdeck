import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, watchedFor } from "../api/format";
import { Card, ErrorNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import {
  DetailActions,
  DetailHeader,
  DetailHero,
  DetailHistory,
  DetailProfileSelect,
  type ExternalLink,
} from "../components/detail";
import { BigButton } from "../components/media";
import { ReleasesSheet } from "../components/ReleasesSheet";
import { RenameCard } from "../components/RenameCard";
import {
  useDeleteLibraryItem,
  useMovieDetail,
  useOptions,
  useServices,
  useTriggerSearch,
  useUpdateLibraryItem,
  useWatched,
} from "../hooks/queries";

export default function MoviePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const movieId = Number(id);
  const navigate = useNavigate();
  const { data, error, isLoading } = useMovieDetail(movieId);
  const { data: options } = useOptions("radarr");
  const { data: services } = useServices();
  const { data: watchedMap } = useWatched(
    (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const update = useUpdateLibraryItem("movies");
  const remove = useDeleteLibraryItem("movies");
  const search = useTriggerSearch();
  const [showReleases, setShowReleases] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const watched = watchedFor(watchedMap?.data, {
    tmdb_id: data?.tmdb_id,
    imdb_id: data?.imdb_id,
  });

  const links: ExternalLink[] = [];
  if (watched?.url) links.push({ label: "Plex", url: watched.url });
  if (data?.imdb_id)
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${data.imdb_id}/` });
  if (data?.tmdb_id)
    links.push({ label: "TMDB", url: `https://www.themoviedb.org/movie/${data.tmdb_id}` });

  return (
    <>
      <DetailHeader title={data?.title} year={data?.year} watched={watched} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && <RenameCard app="radarr" id={movieId} />}
      {data && (
        <>
          <DetailHero
            poster={data.poster}
            overview={data.overview}
            links={links}
            badges={
              <>
                <StateBadge
                  state={
                    data.has_file ? "downloaded" : data.monitored ? "wanted" : "unmonitored"
                  }
                />
                {data.status && <span className="capitalize">{data.status}</span>}
                {data.runtime ? (
                  <span>· {t("movie.runtime", { min: data.runtime })}</span>
                ) : null}
              </>
            }
          />

          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <DetailProfileSelect
                value={data.quality_profile_id}
                options={options}
                disabled={update.isPending}
                onChange={(id) => update.mutate({ id: movieId, quality_profile_id: id })}
              />
            </div>
            <DetailActions
              monitored={data.monitored ?? false}
              busy={update.isPending || remove.isPending || search.isPending}
              confirming={confirmingDelete}
              onConfirmingChange={setConfirmingDelete}
              onToggleMonitor={() => update.mutate({ id: movieId, monitored: !data.monitored })}
              onSearch={() => search.mutate({ app: "radarr", id: movieId })}
              onDelete={(deleteFiles) =>
                remove.mutate({ id: movieId, deleteFiles }, { onSuccess: () => navigate(-1) })
              }
              extra={
                <BigButton color="blue" onClick={() => setShowReleases(true)}>
                  {t("releases.interactive")}
                </BigButton>
              }
            />
          </div>

          <SectionTitle>{t("movie.file")}</SectionTitle>
          <Card>
            {data.file ? (
              <Row>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {data.file.quality}{" "}
                    {data.file.resolution && (
                      <span className="text-muted-foreground">· {data.file.resolution}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(data.file.size)}
                    {data.file.release_group ? ` · ${data.file.release_group}` : ""}
                  </div>
                </div>
              </Row>
            ) : (
              <Row>
                <span className="text-sm text-muted-foreground">{t("movie.noFile")}</span>
              </Row>
            )}
          </Card>

          <DetailHistory history={data.history} />
        </>
      )}
      {showReleases && (
        <ReleasesSheet
          app="radarr"
          params={{ movieId }}
          title={data?.title ?? ""}
          onClose={() => setShowReleases(false)}
        />
      )}
    </>
  );
}
