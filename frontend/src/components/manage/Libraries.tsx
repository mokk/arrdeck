import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { WatchedDot } from "../WatchedDot";
import { formatBytes, watchedFor } from "../../api/format";
import type { LibraryMovie, LibrarySeries, Options } from "../../api/types";
import { Card, EmptyNote, ErrorNote, Row, StateBadge } from "../Blocks";
import { useRegisterSearchbar, useRegisterSortButton } from "../subnav";
import { SortSheet } from "../SortSheet";
import { VirtualList } from "../VirtualList";
import { useSort } from "../sortable";
import {
  useBulkDeleteLibrary,
  useBulkLibrary,
  useServices,
  useTags,
  useWatched,
  useBulkSearchLibrary,
  useDeleteLibraryItem,
  useLibraryMovies,
  useLibrarySeries,
  useOptions,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../../hooks/queries";
import { usePersistentState } from "../../hooks/usePersistentState";

/* ---------------- libraries ---------------- */

function ProfileSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number | null | undefined;
  options: Options | undefined;
  disabled: boolean;
  onChange: (id: number) => void;
}) {
  return (
    <Select
      value={value != null ? String(value) : undefined}
      disabled={disabled || !options}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger size="sm" className="w-auto bg-secondary">
        <SelectValue placeholder="Profile" />
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
}

function DeleteButtons({
  pending,
  onDelete,
}: {
  pending: boolean;
  onDelete: (deleteFiles: boolean) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
        {t("common.delete")}
      </Button>
    );
  return (
    <div className="flex gap-1.5">
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => onDelete(true)}>
        {t("manage.plusFiles")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        disabled={pending}
        onClick={() => onDelete(false)}
      >
        {t("manage.entryOnly")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        ✕
      </Button>
    </div>
  );
}

function LibraryBulkBar({
  kind,
  selected,
  options,
  onDone,
}: {
  kind: "movies" | "series";
  selected: Set<number>;
  options: Options | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkLibrary(kind);
  const bulkDelete = useBulkDeleteLibrary(kind);
  const bulkSearch = useBulkSearchLibrary(kind);
  const { data: tags } = useTags(kind === "movies" ? "radarr" : "sonarr");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [taggingOff, setTaggingOff] = useState(false);
  const ids = [...selected];
  const pending = bulk.isPending || bulkDelete.isPending || bulkSearch.isPending;

  return (
    <div className="fixed bottom-[calc(7.4rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-card/90 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <span className="px-1 text-xs text-muted-foreground">
        {t("dl.selected", { count: ids.length })}
      </span>
      {confirmingDelete ? (
        <>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => bulkDelete.mutate({ ids, delete_files: true }, { onSettled: onDone })}
          >
            {t("manage.plusFiles")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={pending}
            onClick={() => bulkDelete.mutate({ ids, delete_files: false }, { onSettled: onDone })}
          >
            {t("manage.entryOnly")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            ✕
          </Button>
        </>
      ) : (
        <>
          <ProfileSelect
            value={null}
            options={options}
            disabled={pending || !ids.length}
            onChange={(pid) => bulk.mutate({ ids, quality_profile_id: pid }, { onSettled: onDone })}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: true }, { onSettled: onDone })}
          >
            {t("add.monitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: false }, { onSettled: onDone })}
          >
            {t("add.unmonitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => {
              bulkSearch.mutate(ids);
              onDone();
            }}
          >
            {t("common.search")}
          </Button>
          {(tags?.length ?? 0) > 0 && (
            <>
              {/* one row of tag buttons; the toggle flips them between
                  applying and removing so each tag needs only one button */}
              <Button
                size="sm"
                variant="secondary"
                className={taggingOff ? "text-destructive" : undefined}
                onClick={() => setTaggingOff(!taggingOff)}
              >
                {taggingOff ? t("manage.tagRemoving") : t("manage.tagAdding")}
              </Button>
              {(tags ?? []).map((tag) => (
                <Button
                  key={tag.id}
                  size="sm"
                  variant="secondary"
                  disabled={pending || !ids.length}
                  onClick={() =>
                    bulk.mutate(
                      { ids, tags: [tag.id], apply_tags: taggingOff ? "remove" : "add" },
                      { onSettled: onDone },
                    )
                  }
                >
                  {tag.label}
                </Button>
              ))}
            </>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={!ids.length}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("common.delete")}
          </Button>
        </>
      )}
    </div>
  );
}

const MOVIE_SORT_KEYS = ["title", "year", "status", "size_on_disk"];

export function MovieLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, error } = useLibraryMovies();
  const { data: options } = useOptions("radarr");
  const search = useTriggerSearch();
  const update = useUpdateLibraryItem("movies");
  const remove = useDeleteLibraryItem("movies");
  const [q, setQ] = usePersistentState("manage.movies.filter", "");
  const sort = useSort<Record<string, unknown>>("manage.movies", "title");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { data: tags } = useTags("radarr");
  const { data: services } = useServices();
  const { data: watched } = useWatched(
    (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const [tagFilter, setTagFilter] = usePersistentState<number | null>(
    "manage.movies.tag",
    null,
  );
  useRegisterSearchbar(t("manage.filterMovies"), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const withStatus = (data ?? [])
    .filter((m) => (m.title ?? "").toLowerCase().includes(q.toLowerCase()))
    .filter((m) => tagFilter == null || (m.tags ?? []).includes(tagFilter))
    .map((m) => ({
      ...m,
      status: m.has_file ? "downloaded" : m.monitored ? "wanted" : "unmonitored",
    }));
  const shown = sort.sortRows(
    withStatus as unknown as Record<string, unknown>[],
  ) as unknown as (LibraryMovie & { status: string })[];

  return (
    <>
      {(tags?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
              tagFilter == null ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
            )}
            onClick={() => setTagFilter(null)}
          >
            {t("manage.allTags")}
          </button>
          {(tags ?? []).map((tag) => (
            <button
              key={tag.id}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                tagFilter === tag.id
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground",
              )}
              onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex justify-end">
        <Button
          size="sm"
          variant={selectMode ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => {
            setSelectMode(!selectMode);
            setChecked(new Set());
          }}
        >
          {selectMode ? t("dl.done") : t("dl.select")}
        </Button>
      </div>
      <Card>
        <VirtualList
          items={shown}
          estimateSize={96}
          renderRow={(m) => (
            <Row
              className="border-b border-t-0 border-border/60"
              onClick={selectMode ? () => toggleChecked(m.id) : undefined}
            >
              {selectMode && (
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(m.id) ? "border-primary bg-primary" : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(m.id) ? "✓" : ""}
                </div>
              )}
              {m.poster ? (
                <img
                  src={m.poster}
                  alt=""
                  loading="lazy"
                  className="w-10 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
                />
              ) : (
                <div className="w-10 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn("truncate text-sm font-medium", !selectMode && "cursor-pointer active:opacity-70")}
                  onClick={selectMode ? undefined : () => navigate(`/movie/${m.id}`)}
                >
                  {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>{" "}
                  {!selectMode && <span className="text-primary">›</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StateBadge state={m.status} />
                  <WatchedDot item={watchedFor(watched?.data, m)} />
                  {formatBytes(m.size_on_disk)}
                </div>
                {!selectMode && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ProfileSelect
                      value={m.quality_profile_id}
                      options={options}
                      disabled={update.isPending}
                      onChange={(id) => update.mutate({ id: m.id, quality_profile_id: id })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: m.id, monitored: !m.monitored })}
                    >
                      {m.monitored ? t("add.unmonitor") : t("add.monitor")}
                    </Button>
                    {!m.has_file && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={search.isPending}
                        onClick={() => search.mutate({ app: "radarr", id: m.id })}
                      >
                        {t("common.search")}
                      </Button>
                    )}
                    <DeleteButtons
                      pending={remove.isPending}
                      onDelete={(deleteFiles) => remove.mutate({ id: m.id, deleteFiles })}
                    />
                  </div>
                )}
              </div>
            </Row>
          )}
        />
        {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      </Card>
      {selectMode && (
        <LibraryBulkBar
          kind="movies"
          selected={checked}
          options={options}
          onDone={() => {
            setChecked(new Set());
            setSelectMode(false);
          }}
        />
      )}
      {sortOpen && (
        <SortSheet
          options={MOVIE_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
      )}
    </>
  );
}

const SERIES_SORT_KEYS = ["title", "year", "status", "episode_file_count", "size_on_disk"];

export function SeriesLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, error } = useLibrarySeries();
  const { data: options } = useOptions("sonarr");
  const search = useTriggerSearch();
  const update = useUpdateLibraryItem("series");
  const remove = useDeleteLibraryItem("series");
  const [q, setQ] = usePersistentState("manage.series.filter", "");
  const sort = useSort<Record<string, unknown>>("manage.series", "title");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { data: tags } = useTags("sonarr");
  const { data: services } = useServices();
  const { data: watched } = useWatched(
    (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const [tagFilter, setTagFilter] = usePersistentState<number | null>(
    "manage.series.tag",
    null,
  );
  useRegisterSearchbar(t("manage.filterSeries"), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const filtered = (data ?? [])
    .filter((se) => (se.title ?? "").toLowerCase().includes(q.toLowerCase()))
    .filter((se) => tagFilter == null || (se.tags ?? []).includes(tagFilter));
  const shown = sort.sortRows(
    filtered as unknown as Record<string, unknown>[],
  ) as unknown as LibrarySeries[];

  return (
    <>
      {(tags?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
              tagFilter == null ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
            )}
            onClick={() => setTagFilter(null)}
          >
            {t("manage.allTags")}
          </button>
          {(tags ?? []).map((tag) => (
            <button
              key={tag.id}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                tagFilter === tag.id
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground",
              )}
              onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex justify-end">
        <Button
          size="sm"
          variant={selectMode ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => {
            setSelectMode(!selectMode);
            setChecked(new Set());
          }}
        >
          {selectMode ? t("dl.done") : t("dl.select")}
        </Button>
      </div>
      <Card>
        <VirtualList
          items={shown}
          estimateSize={96}
          renderRow={(se) => (
            <Row
              className="border-b border-t-0 border-border/60"
              onClick={selectMode ? () => toggleChecked(se.id) : undefined}
            >
              {selectMode && (
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(se.id)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(se.id) ? "✓" : ""}
                </div>
              )}
              {se.poster ? (
                <img
                  src={se.poster}
                  alt=""
                  loading="lazy"
                  className="w-10 shrink-0 cursor-pointer rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
                  onClick={selectMode ? undefined : () => navigate(`/series/${se.id}`)}
                />
              ) : (
                <div className="w-10 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn("truncate text-sm font-medium", !selectMode && "cursor-pointer active:opacity-70")}
                  onClick={selectMode ? undefined : () => navigate(`/series/${se.id}`)}
                >
                  {se.title} <span className="text-muted-foreground">{se.year ?? ""}</span>{" "}
                  {!selectMode && <span className="text-primary">›</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StateBadge state={se.monitored ? "ok" : "paused"} />
                  <WatchedDot item={watchedFor(watched?.data, se)} />
                  {t("manage.episodes", {
                    files: se.episode_file_count,
                    total: se.episode_count,
                  })}{" "}
                  · {formatBytes(se.size_on_disk)}
                </div>
                {!selectMode && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ProfileSelect
                      value={se.quality_profile_id}
                      options={options}
                      disabled={update.isPending}
                      onChange={(id) => update.mutate({ id: se.id, quality_profile_id: id })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: se.id, monitored: !se.monitored })}
                    >
                      {se.monitored ? t("add.unmonitor") : t("add.monitor")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={search.isPending}
                      onClick={() => search.mutate({ app: "sonarr", id: se.id })}
                    >
                      {t("common.search")}
                    </Button>
                    <DeleteButtons
                      pending={remove.isPending}
                      onDelete={(deleteFiles) => remove.mutate({ id: se.id, deleteFiles })}
                    />
                  </div>
                )}
              </div>
            </Row>
          )}
        />
        {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      </Card>
      {selectMode && (
        <LibraryBulkBar
          kind="series"
          selected={checked}
          options={options}
          onDone={() => {
            setChecked(new Set());
            setSelectMode(false);
          }}
        />
      )}
      {sortOpen && (
        <SortSheet
          options={SERIES_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
      )}
    </>
  );
}
