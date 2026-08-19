import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RenameCard } from "../components/RenameCard";
import { WatchedDot } from "../components/WatchedDot";
import { watchedFor } from "../api/format";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes, formatDateTime } from "../api/format";
import { Card, ErrorNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import { BigButton } from "../components/media";
import { ReleasesSheet } from "../components/ReleasesSheet";
import {
  useDeleteLibraryItem,
  useMovieDetail,
  useOptions,
  useServices,
  useWatched,
  useTriggerSearch,
  useUpdateLibraryItem,
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

  const links: { label: string; url: string }[] = [];
  if (watched?.url) links.push({ label: "Plex", url: watched.url });
  if (data?.imdb_id)
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${data.imdb_id}/` });
  if (data?.tmdb_id)
    links.push({ label: "TMDB", url: `https://www.themoviedb.org/movie/${data.tmdb_id}` });

  return (
    <>
      <div className="mb-4 mt-1 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">
          {data?.title ?? "…"}{" "}
          <span className="font-semibold text-muted-foreground">{data?.year ?? ""}</span>
        </h1>
        <WatchedDot item={watched} />
      </div>
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && <RenameCard app="radarr" id={movieId} />}
      {data && (
        <>
          <div className="mb-5 flex gap-4">
            {data.poster && (
              <img
                src={data.poster}
                alt=""
                className="w-28 shrink-0 rounded-xl bg-card object-cover [aspect-ratio:2/3]"
              />
            )}
            <div className="min-w-0">
              <div className="text-sm leading-relaxed text-muted-foreground">
                {data.overview}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge
                  state={data.has_file ? "downloaded" : data.monitored ? "wanted" : "unmonitored"}
                />
                {data.status && <span className="capitalize">{data.status}</span>}
                {data.runtime ? <span>· {t("movie.runtime", { min: data.runtime })}</span> : null}
              </div>
              {links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {links.map((l) => (
                    <a
                      key={l.label}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-primary"
                    >
                      {l.label} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <Select
                value={data.quality_profile_id != null ? String(data.quality_profile_id) : undefined}
                disabled={update.isPending || !options}
                onValueChange={(v) =>
                  update.mutate({ id: movieId, quality_profile_id: Number(v) })
                }
              >
                <SelectTrigger size="sm" className="w-auto bg-secondary">
                  <SelectValue placeholder={t("add.qualityProfile")} />
                </SelectTrigger>
                <SelectContent>
                  {(options?.quality_profiles ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {confirmingDelete ? (
              <>
                <BigButton
                  color="red"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(
                      { id: movieId, deleteFiles: true },
                      { onSuccess: () => navigate(-1) },
                    )
                  }
                >
                  {t("add.deleteFromDisk")}
                </BigButton>
                <BigButton
                  color="red"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(
                      { id: movieId, deleteFiles: false },
                      { onSuccess: () => navigate(-1) },
                    )
                  }
                >
                  {t("add.removeFromLibrary")}
                </BigButton>
                <BigButton color="muted" onClick={() => setConfirmingDelete(false)}>
                  {t("common.back")}
                </BigButton>
              </>
            ) : (
              <>
                <BigButton
                  color="blue"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: movieId, monitored: !data.monitored })}
                >
                  {data.monitored ? t("add.unmonitor") : t("add.monitor")}
                </BigButton>
                <BigButton
                  color="blue"
                  disabled={search.isPending}
                  onClick={() => search.mutate({ app: "radarr", id: movieId })}
                >
                  {t("add.searchNow")}
                </BigButton>
                <BigButton color="blue" onClick={() => setShowReleases(true)}>
                  {t("releases.interactive")}
                </BigButton>
                <BigButton color="red" onClick={() => setConfirmingDelete(true)}>
                  {t("dl.deleteEllipsis")}
                </BigButton>
              </>
            )}
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

          {(data.history?.length ?? 0) > 0 && (
            <>
              <SectionTitle>{t("dash.recentHistory")}</SectionTitle>
              <Card>
                {(data.history ?? []).map((h, i) => (
                  <Row key={i}>
                    <StateBadge state={h.type} />
                    <div className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(h.date)}
                    </div>
                  </Row>
                ))}
              </Card>
            </>
          )}
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
