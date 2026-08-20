// The Radarr movie library list.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

import { cn, focusRing } from "@/lib/utils";
import { WatchedDot } from "../../WatchedDot";
import { formatBytes, watchedFor } from "../../../api/format";
import type { LibraryMovie } from "../../../api/types";
import { Card, EmptyNote, ErrorNote, Row, StateBadge } from "../../Blocks";
import { useRegisterSearchbar, useRegisterSortButton } from "../../subnav";
import { SortSheet } from "../../SortSheet";
import { VirtualList } from "../../VirtualList";
import { useSort } from "../../sortable";
import {
  useServices,
  useTags,
  useWatched,
  useDeleteLibraryItem,
  useLibraryMovies,
  useOptions,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../../../hooks/queries";
import { usePersistentState } from "../../../hooks/usePersistentState";

/* ---------------- libraries ---------------- */

import { ProfileSelect, DeleteButtons, LibraryBulkBar } from "./shared";

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
                focusRing,
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
                focusRing,
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
                  {!selectMode && <span aria-hidden="true" className="text-primary">›</span>}
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

