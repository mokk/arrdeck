// The Sonarr series library list.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

import { clickable, cn, focusRing } from "@/lib/utils";
import { formatBytes, watchedFor } from "../../../api/format";
import type { LibrarySeries } from "../../../api/types";
import {
  useDeleteLibraryItem,
  useLibrarySeries,
  useOptions,
  useServices,
  useTags,
  useTriggerSearch,
  useUpdateLibraryItem,
  useWatched,
} from "../../../hooks/queries";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { Card, EmptyNote, ErrorNote, Row, StateBadge } from "../../Blocks";
import { SortSheet } from "../../SortSheet";
import { useSort } from "../../sortable";
import { useRegisterSearchbar, useRegisterSortButton } from "../../subnav";
import { VirtualList } from "../../VirtualList";
import { WatchedDot } from "../../WatchedDot";

/* ---------------- libraries ---------------- */

import { DeleteButtons, LibraryBulkBar, ProfileSelect } from "./shared";

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
            type="button"
            className={cn(
              focusRing,
              "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
              tagFilter == null
                ? "bg-primary/15 text-primary"
                : "bg-secondary text-muted-foreground",
            )}
            onClick={() => setTagFilter(null)}
          >
            {t("manage.allTags")}
          </button>
          {(tags ?? []).map((tag) => (
            <button
              type="button"
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
                  {...clickable(selectMode ? undefined : () => navigate(`/series/${se.id}`))}
                />
              ) : (
                <div className="w-10 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate text-sm font-medium",
                    !selectMode && "cursor-pointer active:opacity-70",
                  )}
                  {...clickable(selectMode ? undefined : () => navigate(`/series/${se.id}`))}
                >
                  {se.title} <span className="text-muted-foreground">{se.year ?? ""}</span>{" "}
                  {!selectMode && (
                    <span aria-hidden="true" className="text-primary">
                      ›
                    </span>
                  )}
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
