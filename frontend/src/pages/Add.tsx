import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { Release, SearchResult } from "../api/types";
import {
  Card,
  EmptyNote,
  ErrorNote,
  Row,
  SectionTitle,
} from "../components/Blocks";
import { ReleasesSheet } from "../components/ReleasesSheet";
import { useRegisterSubnav } from "../components/subnav";
import { Sheet } from "../components/Sheet";
import {
  useAddMedia,
  useDeleteLibraryItem,
  useDiscover,
  useGrabRelease,
  useOptions,
  useSearch,
  useServices,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type Tab = "movies" | "series" | "releases";

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

function BigButton({
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
function MediaSheet({ result, onClose }: { result: SearchResult; onClose: () => void }) {
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
    <Select value={value != null ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
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
        <Label className="mb-1.5 text-xs text-muted-foreground">{t("add.qualityProfile")}</Label>
        {profileSelect(profile, setProfileId)}
        <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">{t("add.rootFolder")}</Label>
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
          <Label className="mb-1.5 text-xs text-muted-foreground">{t("add.qualityProfile")}</Label>
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

function PosterGrid({ results }: { results: SearchResult[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-3.5">
        {results.map((r) => (
          <div
            key={`${r.kind}-${r.remote_id}`}
            className="flex cursor-pointer flex-col gap-1.5 active:opacity-70"
            onClick={() => setSelected(r)}
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

function ReleaseList({ releases }: { releases: Release[] }) {
  const { t } = useTranslation();
  const grab = useGrabRelease();
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  return (
    <Card>
      {releases.map((r) => (
        <Row key={r.guid}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{r.title}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {r.indexer} · {formatBytes(r.size)} ·{" "}
              {t("add.seeders", { count: r.seeders ?? 0 })}
              {r.age_days != null
                ? ` · ${t("add.daysOld", { count: Math.round(r.age_days) })}`
                : ""}
            </div>
          </div>
          <Button
            size="sm"
            disabled={grab.isPending || grabbed.has(r.guid)}
            onClick={() =>
              grab.mutate(
                { guid: r.guid, indexer_id: r.indexer_id },
                { onSuccess: () => setGrabbed(new Set(grabbed).add(r.guid)) },
              )
            }
          >
            {grabbed.has(r.guid) ? t("add.grabbed") : t("add.grab")}
          </Button>
        </Row>
      ))}
      {releases.length === 0 && <EmptyNote>{t("add.noReleases")}</EmptyNote>}
    </Card>
  );
}

const TAB_SERVICE: Record<Tab, string> = {
  movies: "radarr",
  series: "sonarr",
  releases: "prowlarr",
};

export default function Add() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service),
  );
  const tabs = (["movies", "series", "releases"] as Tab[]).filter((tab) =>
    configured.has(TAB_SERVICE[tab] as never),
  );

  const [storedTab, setTab] = usePersistentState<Tab>("add.tab", "movies");
  const tab = tabs.includes(storedTab) ? storedTab : tabs[0];
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const searching = query.trim().length > 1;
  const canDiscover = configured.has("overseerr" as never);
  const search = useSearch(tab ?? "movies", query);
  const discover = useDiscover(
    tab === "series" ? "series" : "movies",
    tab != null && tab !== "releases" && !searching && canDiscover,
  );

  const onTab = (t: Tab) => {
    setTab(t);
    setInput("");
    setQuery("");
  };

  useRegisterSubnav(
    tabs.map((tb) => ({ value: tb, label: t(`add.${tb}`) })),
    tab ?? "movies",
    (v) => onTab(v as Tab),
  );

  if (services && tabs.length === 0) {
    return (
      <>
        <EmptyNote>{t("add.noServices")}</EmptyNote>
      </>
    );
  }

  const searchPlaceholder =
    tab === "releases"
      ? t("add.searchReleases")
      : tab === "series"
        ? t("add.searchSeries")
        : t("add.searchMovies");

  return (
    <>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input);
        }}
      >
        <Input
          placeholder={searchPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" disabled={search.isFetching}>
          {search.isFetching ? "…" : t("common.search")}
        </Button>
      </form>

      {search.error && searching && <ErrorNote>{(search.error as Error).message}</ErrorNote>}

      {tab === "releases" ? (
        searching && search.data ? (
          <ReleaseList releases={search.data as Release[]} />
        ) : (
          <EmptyNote>{t("add.searchProwlarr")}</EmptyNote>
        )
      ) : searching ? (
        search.data ? (
          <PosterGrid results={search.data as SearchResult[]} />
        ) : null
      ) : canDiscover ? (
        <>
          <SectionTitle>
            {tab === "series" ? t("add.popularSeries") : t("add.popularMovies")}
          </SectionTitle>
          {discover.error && <ErrorNote>{(discover.error as Error).message}</ErrorNote>}
          {discover.data ? (
            <PosterGrid results={discover.data} />
          ) : (
            !discover.error && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-3.5">
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} className="w-full rounded-xl [aspect-ratio:2/3]" />
                ))}
              </div>
            )
          )}
        </>
      ) : (
        <EmptyNote>{t("add.configureOverseerr")}</EmptyNote>
      )}
    </>
  );
}
