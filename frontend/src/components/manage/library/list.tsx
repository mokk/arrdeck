// The scaffolding both library lists share: tag chips, select mode, the virtual
// list, the bulk bar and the sort sheet. movies.tsx and series.tsx were 76%
// identical, so a fix applied to one and not the other looked correct in review.
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { clickable, cn, focusRing } from "@/lib/utils";
import { watchedFor } from "../../../api/format";
import {
  useDeleteLibraryItem,
  useOptions,
  useServices,
  useTags,
  useTriggerSearch,
  useUpdateLibraryItem,
  useWatched,
} from "../../../hooks/queries";
import { usePersistentState } from "../../../hooks/usePersistentState";
import { Card, EmptyNote, ErrorNote, Row } from "../../Blocks";
import { SortSheet } from "../../SortSheet";
import { useSort } from "../../sortable";
import { useRegisterSearchbar, useRegisterSortButton } from "../../subnav";
import { VirtualList } from "../../VirtualList";
import { WatchedDot } from "../../WatchedDot";
import { DeleteButtons, LibraryBulkBar, ProfileSelect } from "./shared";

/** The fields the shared scaffolding reads. Both LibraryMovie and LibrarySeries
 * satisfy this; anything list-specific goes through renderBadge/renderStats. */
type LibraryRow = {
  id: number;
  title?: string | null;
  year?: number | null;
  poster?: string | null;
  tags?: number[] | null;
  monitored?: boolean | null;
  quality_profile_id?: number | null;
  // Plex indexes watched state under whichever external id it knows.
  tmdb_id?: number | null;
  tvdb_id?: number | null;
  imdb_id?: string | null;
};

type Kind = "movies" | "series";

const CONFIG = {
  movies: {
    app: "radarr",
    route: "movie",
    placeholder: "manage.filterMovies",
    sortKeys: ["title", "year", "status", "size_on_disk"],
  },
  series: {
    app: "sonarr",
    route: "series",
    placeholder: "manage.filterSeries",
    sortKeys: ["title", "year", "status", "episode_file_count", "size_on_disk"],
  },
} as const;

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        focusRing,
        "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
        active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function LibraryList<T extends LibraryRow>({
  kind,
  items,
  error,
  prepare,
  renderBadge,
  renderStats,
  showSearch,
  posterOpens,
}: {
  kind: Kind;
  items: T[] | undefined;
  error: unknown;
  /** Derive fields the list sorts on but the API doesn't return (movie status). */
  prepare?: (items: T[]) => T[];
  /** Left of the watched dot. Movies show a derived download status; series
   * show monitored state. */
  renderBadge: (item: T) => ReactNode;
  /** Right of the watched dot: size for movies, episode counts plus size for
   * series. */
  renderStats: (item: T) => ReactNode;
  /** Movies hide Search once the file is on disk; series always offer it. */
  showSearch?: (item: T) => boolean;
  /** Only the series poster opens the detail page today. Preserved rather than
   * unified, because this refactor is meant to change nothing. */
  posterOpens?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = CONFIG[kind];
  const { data: options } = useOptions(config.app);
  const search = useTriggerSearch();
  const update = useUpdateLibraryItem(kind);
  const remove = useDeleteLibraryItem(kind);
  const [q, setQ] = usePersistentState(`manage.${kind}.filter`, "");
  const sort = useSort<Record<string, unknown>>(`manage.${kind}`, "title");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { data: tags } = useTags(config.app);
  const { data: services } = useServices();
  const { data: watched } = useWatched(
    (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const [tagFilter, setTagFilter] = usePersistentState<number | null>(
    `manage.${kind}.tag`,
    null,
  );
  useRegisterSearchbar(t(config.placeholder), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const filtered = (items ?? [])
    .filter((item) => (item.title ?? "").toLowerCase().includes(q.toLowerCase()))
    .filter((item) => tagFilter == null || (item.tags ?? []).includes(tagFilter));
  const shown = sort.sortRows(
    (prepare ? prepare(filtered) : filtered) as unknown as Record<string, unknown>[],
  ) as unknown as T[];

  const open = (item: T) => navigate(`/${config.route}/${item.id}`);

  return (
    <>
      {(tags?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <TagChip
            label={t("manage.allTags")}
            active={tagFilter == null}
            onClick={() => setTagFilter(null)}
          />
          {(tags ?? []).map((tag) => (
            <TagChip
              key={tag.id}
              label={tag.label}
              active={tagFilter === tag.id}
              onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
            />
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
          renderRow={(item) => (
            <Row
              className="border-b border-t-0 border-border/60"
              onClick={selectMode ? () => toggleChecked(item.id) : undefined}
            >
              {selectMode && (
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(item.id)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(item.id) ? "✓" : ""}
                </div>
              )}
              {item.poster ? (
                <img
                  src={item.poster}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "w-10 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]",
                    posterOpens && "cursor-pointer",
                  )}
                  {...(posterOpens ? clickable(selectMode ? undefined : () => open(item)) : {})}
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
                  {...clickable(selectMode ? undefined : () => open(item))}
                >
                  {item.title} <span className="text-muted-foreground">{item.year ?? ""}</span>{" "}
                  {!selectMode && (
                    <span aria-hidden="true" className="text-primary">
                      ›
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {renderBadge(item)}
                  <WatchedDot item={watchedFor(watched?.data, item)} />
                  {renderStats(item)}
                </div>
                {!selectMode && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ProfileSelect
                      value={item.quality_profile_id}
                      options={options}
                      disabled={update.isPending}
                      onChange={(id) => update.mutate({ id: item.id, quality_profile_id: id })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: item.id, monitored: !item.monitored })}
                    >
                      {item.monitored ? t("add.unmonitor") : t("add.monitor")}
                    </Button>
                    {(showSearch ? showSearch(item) : true) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={search.isPending}
                        onClick={() => search.mutate({ app: config.app, id: item.id })}
                      >
                        {t("common.search")}
                      </Button>
                    )}
                    <DeleteButtons
                      pending={remove.isPending}
                      onDelete={(deleteFiles) => remove.mutate({ id: item.id, deleteFiles })}
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
          kind={kind}
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
          options={config.sortKeys.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
      )}
    </>
  );
}
