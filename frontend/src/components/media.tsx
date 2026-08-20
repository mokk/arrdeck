import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clickable, cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { SearchResult } from "../api/types";
import {
  useAddMedia,
  useDeleteLibraryItem,
  useOptions,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../hooks/queries";
import { ErrorNote } from "./Blocks";
import { ReleasesSheet } from "./ReleasesSheet";
import { Sheet } from "./Sheet";

function MediaHead({ result }: { result: SearchResult }) {
  const { t } = useTranslation();
  const links: { label: string; url: string }[] = [];
  if (result.imdb_id)
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${result.imdb_id}/` });
  if (result.tmdb_id)
    links.push({
      label: "TMDB",
      url: `https://www.themoviedb.org/${result.kind === "movie" ? "movie" : "tv"}/${result.tmdb_id}`,
    });
  if (result.kind === "series")
    links.push({
      label: "TVDB",
      url: `https://www.thetvdb.com/dereferrer/series/${result.remote_id}`,
    });

  return (
    <div className="mb-4 flex gap-3">
      {result.poster && (
        <img
          src={result.poster}
          alt=""
          className="w-[72px] shrink-0 rounded-lg bg-secondary object-cover [aspect-ratio:2/3]"
        />
      )}
      <div className="min-w-0">
        <div className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">
          {result.overview || t("add.noDescription")}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {result.kind === "movie" ? t("add.movie") : t("add.seriesKind")}
          {result.year ? ` · ${result.year}` : ""}
          {result.in_library
            ? ` · ${
                result.has_file
                  ? t("add.downloadedState")
                  : result.monitored
                    ? t("add.monitoredState")
                    : t("add.inLibraryUnmonitored")
              }`
            : ` · ${t("add.notInLibrary")}`}
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
  );
}

export function BigButton({
  color,
  disabled,
  onClick,
  children,
}: {
  color?: "blue" | "red" | "muted";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={color === "muted" ? "ghost" : "secondary"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-2 h-11 w-full rounded-xl text-[0.95rem]",
        color === "blue" && "text-primary",
        color === "red" && "text-destructive",
        color === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}

/** One sheet for both cases: add when not in library, edit when it is. */
export function MediaSheet({ result, onClose }: { result: SearchResult; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const kind = result.kind === "movie" ? ("movies" as const) : ("series" as const);
  const app = result.kind === "movie" ? ("radarr" as const) : ("sonarr" as const);
  const { data: options } = useOptions(app);
  const add = useAddMedia();
  const update = useUpdateLibraryItem(kind);
  const remove = useDeleteLibraryItem(kind);
  const search = useTriggerSearch();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showReleases, setShowReleases] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [rootPath, setRootPath] = useState<string | null>(null);

  if (showReleases && result.library_id) {
    return (
      <ReleasesSheet
        app="radarr"
        params={{ movieId: result.library_id }}
        title={result.title}
        onClose={onClose}
      />
    );
  }

  const pending = add.isPending || update.isPending || remove.isPending || search.isPending;
  const title = `${result.title}${result.year ? ` (${result.year})` : ""}`;

  const profileSelect = (value: number | null | undefined, onChange: (id: number) => void) => (
    <Select
      value={value != null ? String(value) : undefined}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger className="w-full bg-secondary">
        <SelectValue placeholder="Quality profile" />
      </SelectTrigger>
      <SelectContent>
        {(options?.quality_profiles ?? []).map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!result.in_library) {
    const profile = profileId ?? options?.quality_profiles[0]?.id;
    const root = rootPath ?? options?.root_folders[0]?.path;
    return (
      <Sheet title={title} onClose={onClose}>
        <MediaHead result={result} />
        <Label className="mb-1.5 text-xs text-muted-foreground">
          {t("add.qualityProfile")}
        </Label>
        {profileSelect(profile, setProfileId)}
        <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">
          {t("add.rootFolder")}
        </Label>
        <Select value={root ?? undefined} onValueChange={setRootPath}>
          <SelectTrigger className="w-full bg-secondary">
            <SelectValue placeholder={t("add.rootFolder")} />
          </SelectTrigger>
          <SelectContent>
            {(options?.root_folders ?? []).map((f) => (
              <SelectItem key={f.id} value={f.path}>
                {f.path}{" "}
                {f.free_space != null
                  ? `(${t("add.free", { space: formatBytes(f.free_space) })})`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {add.isError && <ErrorNote>{(add.error as Error).message}</ErrorNote>}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            className="h-11 flex-1 rounded-xl"
            disabled={!profile || !root || pending}
            onClick={() =>
              add.mutate(
                {
                  kind: result.kind,
                  remote_id: result.remote_id,
                  title: result.title,
                  quality_profile_id: profile!,
                  root_folder_path: root!,
                },
                { onSuccess: onClose },
              )
            }
          >
            {add.isPending ? t("add.adding") : t("add.addAndSearch")}
          </Button>
        </div>
      </Sheet>
    );
  }

  const id = result.library_id!;
  return (
    <Sheet title={title} onClose={onClose}>
      <MediaHead result={result} />
      {confirmingDelete ? (
        <>
          <BigButton
            color="red"
            disabled={pending}
            onClick={() => remove.mutate({ id, deleteFiles: true }, { onSettled: onClose })}
          >
            {t("add.deleteFromDisk")}
          </BigButton>
          <BigButton
            color="red"
            disabled={pending}
            onClick={() => remove.mutate({ id, deleteFiles: false }, { onSettled: onClose })}
          >
            {t("add.removeFromLibrary")}
          </BigButton>
          <BigButton color="muted" onClick={() => setConfirmingDelete(false)}>
            {t("common.back")}
          </BigButton>
        </>
      ) : (
        <>
          <Label className="mb-1.5 text-xs text-muted-foreground">
            {t("add.qualityProfile")}
          </Label>
          {profileSelect(result.quality_profile_id, (pid) =>
            update.mutate({ id, quality_profile_id: pid }, { onSettled: onClose }),
          )}
          <div className="h-3" />
          <BigButton
            color="blue"
            disabled={pending}
            onClick={() =>
              update.mutate({ id, monitored: !result.monitored }, { onSettled: onClose })
            }
          >
            {result.monitored ? t("add.unmonitor") : t("add.monitor")}
          </BigButton>
          <BigButton
            color="blue"
            disabled={pending}
            onClick={() => search.mutate({ app, id }, { onSettled: onClose })}
          >
            {t("add.searchNow")}
          </BigButton>
          {result.kind === "movie" ? (
            <BigButton color="blue" onClick={() => setShowReleases(true)}>
              {t("releases.interactive")}
            </BigButton>
          ) : (
            <BigButton color="blue" onClick={() => navigate(`/series/${id}`)}>
              {t("series.manageSeasons")}
            </BigButton>
          )}
          <BigButton color="red" onClick={() => setConfirmingDelete(true)}>
            {t("dl.deleteEllipsis")}
          </BigButton>
          <BigButton color="muted" onClick={onClose}>
            {t("common.cancel")}
          </BigButton>
        </>
      )}
    </Sheet>
  );
}

export function PosterGrid({ results }: { results: SearchResult[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-3.5">
        {results.map((r) => (
          <div
            key={`${r.kind}-${r.remote_id}`}
            className="flex cursor-pointer flex-col gap-1.5 active:opacity-70"
            {...clickable(() => setSelected(r))}
          >
            {r.poster ? (
              <img
                src={r.poster}
                alt=""
                loading="lazy"
                className="w-full rounded-xl bg-card object-cover [aspect-ratio:2/3]"
              />
            ) : (
              <div className="flex w-full items-center justify-center rounded-xl bg-card p-2 text-center text-xs text-muted-foreground [aspect-ratio:2/3]">
                {r.title}
              </div>
            )}
            <div className="line-clamp-2 min-h-[2.5em] text-xs font-semibold leading-tight">
              {r.title}
            </div>
            <div className="-mt-1 text-[0.7rem] text-muted-foreground">{r.year ?? ""}</div>
            {r.in_library && (r.has_file || r.monitored) && (
              <div
                className={cn(
                  "mt-auto text-[0.7rem] font-medium",
                  r.has_file ? "text-success" : "text-primary",
                )}
              >
                {r.has_file ? t("add.downloadedBadge") : t("add.monitoredBadge")}
              </div>
            )}
          </div>
        ))}
      </div>
      {selected && <MediaSheet result={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
