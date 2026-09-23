// The three library tabs: a scrollable grid of covers with search, sort and
// add docked at the bottom. Configuration per library over one grid, the way
// the iOS LibraryPage does it.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { watchedFor } from "../api/format";
import type { LibraryBook, LibraryKind, LibraryMovie, LibrarySeries } from "../api/types";
import { EmptyNote, ErrorNote } from "../components/Blocks";
import { LibraryBulkBar } from "../components/manage/library/shared";
import { SortSheet } from "../components/SortSheet";
import { useSort } from "../components/sortable";
import {
  useRegisterAddButton,
  useRegisterSearchbar,
  useRegisterSortButton,
} from "../components/subnav";
import { WatchedDot } from "../components/WatchedDot";
import {
  useLibraryBooks,
  useLibraryMovies,
  useLibrarySeries,
  useOptions,
  useServices,
  useWatched,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

/** One card. Each library maps its row onto this so the grid stays generic;
 * `status` is derived here because the sort sheet offers it. */
interface Card {
  id: number;
  title: string;
  subtitle: string;
  poster?: string | null;
  year?: number | null;
  author?: string | null;
  added?: string | null;
  status: "downloaded" | "wanted" | "unmonitored" | "continuing" | "ended";
  size_on_disk?: number;
  episode_file_count?: number;
  tmdb_id?: number | null;
  tvdb_id?: number | null;
  imdb_id?: string | null;
  [key: string]: unknown;
}

const CONFIG = {
  movies: {
    app: "radarr",
    route: "movie",
    placeholder: "library.searchMovies",
    sortKeys: ["added", "title", "year", "status", "size_on_disk"],
    addTab: "movies",
  },
  series: {
    app: "sonarr",
    route: "series",
    placeholder: "library.searchShows",
    sortKeys: ["added", "title", "year", "status", "episode_file_count", "size_on_disk"],
    addTab: "series",
  },
  books: {
    app: "readarr",
    route: "book",
    placeholder: "library.searchBooks",
    sortKeys: ["added", "author", "title", "year", "status", "size_on_disk"],
    addTab: "books",
  },
} as const;

const fileStatus = (row: { has_file?: boolean; monitored?: boolean }) =>
  row.has_file ? "downloaded" : row.monitored ? "wanted" : "unmonitored";

const DOT: Record<Card["status"], string> = {
  downloaded: "bg-emerald-500",
  ended: "bg-emerald-500",
  continuing: "bg-sky-500",
  wanted: "bg-amber-500",
  unmonitored: "bg-muted-foreground/50",
};

export function MoviesPage() {
  const { data, error, isLoading } = useLibraryMovies();
  return (
    <LibraryGrid
      kind="movies"
      error={error}
      loading={isLoading}
      cards={data?.map((m: LibraryMovie) => ({
        ...m,
        title: m.title ?? "",
        subtitle: m.year ? String(m.year) : "",
        status: fileStatus(m),
      }))}
    />
  );
}

export function ShowsPage() {
  const { t } = useTranslation();
  const { data, error, isLoading } = useLibrarySeries();
  return (
    <LibraryGrid
      kind="series"
      error={error}
      loading={isLoading}
      cards={data?.map((s: LibrarySeries) => ({
        ...s,
        title: s.title ?? "",
        subtitle: t("manage.episodes", { files: s.episode_file_count, total: s.episode_count }),
        status: !s.monitored ? "unmonitored" : s.status === "ended" ? "ended" : "continuing",
      }))}
    />
  );
}

export function BooksPage() {
  const { data, error, isLoading } = useLibraryBooks();
  return (
    <LibraryGrid
      kind="books"
      error={error}
      loading={isLoading}
      cards={data?.map((b: LibraryBook) => ({
        ...b,
        title: b.title ?? "",
        subtitle: [b.author, b.year].filter(Boolean).join(" · "),
        status: fileStatus(b),
      }))}
    />
  );
}

function LibraryGrid({
  kind,
  cards,
  error,
  loading,
}: {
  kind: LibraryKind;
  cards: Card[] | undefined;
  error: unknown;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = CONFIG[kind];
  const { data: options } = useOptions(config.app);
  const { data: services } = useServices();
  const { data: watched } = useWatched(
    kind !== "books" && (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  const [q, setQ] = usePersistentState(`library.${kind}.filter`, "");
  // Newest additions first, the way the app opens too. `added` is an ISO
  // timestamp, so string order is date order. A fresh storage key so the
  // default reaches people who already had "title" persisted.
  const sort = useSort<Record<string, unknown>>(`library.${kind}.sort`, "added", "desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useRegisterSearchbar(t(config.placeholder), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));
  const addTab = config.addTab;
  useRegisterAddButton(t("library.add"), addTab ? () => navigate(`/add?tab=${addTab}`) : null);

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const needle = q.trim().toLowerCase();
  const shown = sort.sortRows(
    (cards ?? []).filter(
      (c) =>
        !needle ||
        c.title.toLowerCase().includes(needle) ||
        (c.author ?? "").toLowerCase().includes(needle),
    ) as unknown as Record<string, unknown>[],
  ) as unknown as Card[];

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };
  const leaveSelect = () => {
    setChecked(new Set());
    setSelectMode(false);
  };

  return (
    <>
      {selectMode && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t("dl.selected", { count: checked.size })}
          </span>
          <Button size="sm" variant="default" className="rounded-full" onClick={leaveSelect}>
            {t("dl.done")}
          </Button>
        </div>
      )}
      {loading && !cards && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="w-full rounded-xl [aspect-ratio:2/3]" />
          ))}
        </div>
      )}
      <div
        data-testid="library-grid"
        className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
      >
        {shown.map((card) => (
          <button
            type="button"
            key={card.id}
            className={cn(
              focusRing,
              // no rounding and no paint containment on the card itself: both
              // clipped the subtitle's descenders. The cover has its own corners.
              "min-w-0 pb-1 text-left active:opacity-70",
            )}
            onClick={() =>
              selectMode ? toggleChecked(card.id) : navigate(`/${config.route}/${card.id}`)
            }
          >
            <div className="relative">
              {card.poster ? (
                <img
                  src={card.poster}
                  alt=""
                  loading="lazy"
                  className="w-full rounded-xl bg-secondary object-cover [aspect-ratio:2/3]"
                />
              ) : (
                <div className="flex w-full items-center justify-center rounded-xl bg-secondary p-2 text-center text-xs text-muted-foreground [aspect-ratio:2/3]">
                  {card.title}
                </div>
              )}
              {selectMode && (
                <div
                  className={cn(
                    "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 text-xs text-white",
                    checked.has(card.id)
                      ? "border-primary bg-primary"
                      : "border-white/80 bg-black/30",
                  )}
                >
                  {checked.has(card.id) ? "✓" : ""}
                </div>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", DOT[card.status])}
              />
              <span className="truncate text-sm font-medium">{card.title}</span>
              <WatchedDot item={watchedFor(watched?.data, card)} />
            </div>
            <div className="truncate text-xs text-muted-foreground">{card.subtitle}</div>
          </button>
        ))}
      </div>
      {cards && shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      {selectMode && (
        <LibraryBulkBar kind={kind} selected={checked} options={options} onDone={leaveSelect} />
      )}
      {sortOpen && (
        <SortSheet
          options={config.sortKeys.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        >
          {/* bulk editing lives behind the sort sheet so the grid itself stays
              free of buttons */}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setSelectMode(true);
              setSortOpen(false);
            }}
          >
            {t("library.select")}
          </Button>
        </SortSheet>
      )}
    </>
  );
}
