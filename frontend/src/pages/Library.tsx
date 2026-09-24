// The three library tabs: covers, a compact list or a detailed list, with
// search, sort and add docked at the bottom. Configuration per library over one
// view, the way the iOS LibraryPage does it.
import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes, formatWhen, watchedFor } from "../api/format";
import type {
  LibraryBook,
  LibraryKind,
  LibraryMovie,
  LibrarySeries,
  RequestState,
  WatchedItem,
} from "../api/types";
import { ErrorNote } from "../components/Blocks";
import { openGlobalSearch } from "../components/GlobalSearch";
import { CardMenu, type MenuTarget } from "../components/library/CardMenu";
import { CollectionsList } from "../components/library/Collections";
import { Cover } from "../components/library/Cover";
import { LetterScrubber, letterAnchor, letterOf } from "../components/library/LetterScrubber";
import { READING } from "../components/library/Reading";
import { SeasonGrid } from "../components/library/SeasonGrid";
import { ShelfView } from "../components/library/Shelf";
import { UpNextView } from "../components/library/UpNext";
import { LibraryBulkBar } from "../components/manage/library/shared";
import { RequestBadge, requestFor, useRequests } from "../components/Requests";
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
  useQueue,
  useReading,
  useServices,
  useWatched,
} from "../hooks/queries";
import { useLongPress } from "../hooks/useLongPress";
import { usePersistentState } from "../hooks/usePersistentState";
import { LAYOUTS_FOR, type Layout, setPref, usePref } from "../lib/prefs";
import { setSequence } from "../lib/sequence";

/** One card. Each library maps its row onto this so the view stays generic;
 * `status` is derived here because the sort sheet offers it. */
interface Card {
  id: number;
  title: string;
  subtitle: string;
  /** the extra line the details layout shows: quality, size, network… */
  detail: string;
  poster?: string | null;
  year?: number | null;
  author?: string | null;
  added?: string | null;
  monitored?: boolean;
  slug?: string | null;
  status: "downloaded" | "wanted" | "unmonitored" | "continuing" | "ended";
  /** books: the reading status, when one is set */
  reading?: string | null;
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

// the sorts a letter index makes sense for
const LETTER_SORTS = new Set(["title", "author"]);
// the views that bring their own grouping and order, so sort and the letter
// strip do not apply to them
const OWN_ORDER = new Set<Layout>(["upnext", "seasons", "shelf", "collections"]);
// room for the letter strip on a phone, where the content reaches the edge
const gutter = "mr-5 sm:mr-0";

const fileStatus = (row: { has_file?: boolean; monitored?: boolean }) =>
  row.has_file ? "downloaded" : row.monitored ? "wanted" : "unmonitored";

// the theme's own status colours, so a palette recolours the dots too
const DOT: Record<Card["status"], string> = {
  downloaded: "bg-success",
  ended: "bg-success",
  continuing: "bg-primary",
  wanted: "bg-warning",
  unmonitored: "bg-muted-foreground/50",
};

const joined = (...parts: (string | number | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");

const size = (bytes: number | undefined) => (bytes ? formatBytes(bytes) : null);

export function MoviesPage() {
  const { data, error, isLoading } = useLibraryMovies();
  return (
    <LibraryView
      kind="movies"
      error={error}
      loading={isLoading}
      cards={data?.map((m: LibraryMovie) => ({
        ...m,
        title: m.title ?? "",
        subtitle: m.year ? String(m.year) : "",
        detail: joined(m.quality, size(m.size_on_disk), m.rating && `★ ${m.rating.toFixed(1)}`),
        status: fileStatus(m),
      }))}
    />
  );
}

export function ShowsPage() {
  const { t } = useTranslation();
  const { data, error, isLoading } = useLibrarySeries();
  return (
    <LibraryView
      kind="series"
      error={error}
      loading={isLoading}
      cards={data?.map((s: LibrarySeries) => ({
        ...s,
        title: s.title ?? "",
        subtitle: t("manage.episodes", { files: s.episode_file_count, total: s.episode_count }),
        detail: joined(s.network, s.year, size(s.size_on_disk)),
        status: !s.monitored ? "unmonitored" : s.status === "ended" ? "ended" : "continuing",
      }))}
    />
  );
}

export function BooksPage() {
  const { t } = useTranslation();
  const { data, error, isLoading } = useLibraryBooks();
  const { data: reading } = useReading();
  return (
    <LibraryView
      kind="books"
      error={error}
      loading={isLoading}
      cards={data?.map((b: LibraryBook) => {
        const status = reading?.[String(b.id)]?.status;
        return {
          ...b,
          title: b.title ?? "",
          subtitle: joined(b.author, b.year),
          detail: joined(
            status && t(`reading.${status}`),
            b.series_title,
            size(b.size_on_disk),
          ),
          status: fileStatus(b),
          reading: status ?? null,
        };
      })}
    />
  );
}

function LibraryView({
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
  const layout = usePref(`layout.${kind}`);
  const unmonitored = usePref(`unmonitored.${kind}`);
  const { data: options } = useOptions(config.app);
  const { data: services } = useServices();
  const { data: watched } = useWatched(
    kind !== "books" && (services ?? []).some((sv) => sv.service === "plex" && sv.configured),
  );
  // What is downloading right now, per title: a bar on its cover.
  const { data: queue } = useQueue();
  const progress = new Map<number, number>();
  for (const item of queue?.[config.app]?.data ?? []) {
    const id =
      kind === "movies" ? item.movie_id : kind === "series" ? item.series_id : item.book_id;
    if (id == null) continue;
    const done = item.size ? 1 - (item.size_left ?? 0) / item.size : 0;
    // a show with several episodes in the queue shows the furthest along
    progress.set(id, Math.max(progress.get(id) ?? 0, done));
  }
  const requests = useRequests();
  const [q, setQ] = usePersistentState(`library.${kind}.filter`, "");
  // books only: narrow to one reading status
  const [readingFilter, setReadingFilter] = usePersistentState<string>(
    "library.books.reading",
    "",
  );
  // Newest additions first, the way the app opens too. `added` is an ISO
  // timestamp, so string order is date order. A fresh storage key so the
  // default reaches people who already had "title" persisted.
  const sort = useSort<Record<string, unknown>>(`library.${kind}.sort`, "added", "desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useRegisterSearchbar(t(config.placeholder), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));
  const addTab = config.addTab;
  const add = () => navigate(`/add?tab=${addTab}`);
  useRegisterAddButton(t("library.add"), add);

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const needle = q.trim().toLowerCase();
  const visible = (cards ?? []).filter(
    (c) =>
      (unmonitored !== "hide" || c.status !== "unmonitored") &&
      (kind !== "books" || !readingFilter || c.reading === readingFilter),
  );
  const nowReading =
    kind === "books" && !needle ? (cards ?? []).filter((c) => c.reading === "reading") : [];
  const shown = sort.sortRows(
    visible.filter(
      (c) =>
        !needle ||
        c.title.toLowerCase().includes(needle) ||
        (c.author ?? "").toLowerCase().includes(needle),
    ) as unknown as Record<string, unknown>[],
  ) as unknown as Card[];

  // The first card of each letter carries the anchor the scrubber jumps to.
  const ownOrder = OWN_ORDER.has(layout);
  const byLetter = LETTER_SORTS.has(sort.sortKey) && !ownOrder;
  const anchors = new Map<number, string>();
  if (byLetter) {
    for (const card of shown) {
      const letter = letterOf(card[sort.sortKey]);
      if (![...anchors.values()].includes(letter)) anchors.set(card.id, letter);
    }
  }

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

  const items = shown.map((card) => {
    const watchedItem = watchedFor(watched?.data, card);
    return (
      <LibraryItem
        key={card.id}
        card={card}
        layout={layout}
        anchor={anchors.get(card.id)}
        dimmed={unmonitored === "dim" && card.status === "unmonitored"}
        watched={watchedItem}
        progress={progress.get(card.id)}
        request={
          kind === "books"
            ? undefined
            : requestFor(requests, {
                kind: kind === "movies" ? "movie" : "tv",
                tmdb_id: card.tmdb_id,
                tvdb_id: card.tvdb_id,
              })
        }
        checked={selectMode ? checked.has(card.id) : undefined}
        onOpen={() => {
          if (selectMode) return toggleChecked(card.id);
          setSequence(
            config.route,
            shown.map((c) => c.id),
          );
          navigate(`/${config.route}/${card.id}`);
        }}
        onMenu={() =>
          !selectMode &&
          setMenu({
            id: card.id,
            title: card.title,
            monitored: card.monitored,
            slug: card.slug,
            plexUrl: watchedItem?.url,
          })
        }
      />
    );
  });

  return (
    <>
      <button
        type="button"
        aria-label={t("globalSearch.title")}
        title={`${t("globalSearch.title")} (⌘K)`}
        onClick={openGlobalSearch}
        className={cn(
          focusRing,
          "fixed right-3 top-[calc(env(safe-area-inset-top)+0.6rem)] z-40 flex size-9 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur-xl active:opacity-60",
        )}
      >
        <Search className="size-4" />
      </button>
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
      {nowReading.length > 0 && layout !== "shelf" && (
        <section className="mb-5">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reading.now")}
          </h2>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {nowReading.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/book/${c.id}`)}
                className={cn(focusRing, "w-24 shrink-0 text-left active:opacity-70")}
              >
                <Cover src={c.poster} title={c.title} subtitle={c.author} />
                <div className="mt-1 truncate text-xs font-medium">{c.title}</div>
              </button>
            ))}
          </div>
        </section>
      )}
      {loading && !cards && <LoadingView layout={layout} />}
      {layout === "upnext" ? (
        <UpNextView
          rows={shown as unknown as LibrarySeries[]}
          onOpen={(id, order) => {
            setSequence("series", order);
            navigate(`/series/${id}`);
          }}
        />
      ) : layout === "seasons" ? (
        <SeasonGrid needle={needle} onOpen={(id) => navigate(`/series/${id}`)} />
      ) : layout === "shelf" ? (
        <ShelfView
          books={shown as unknown as LibraryBook[]}
          needle={needle}
          onOpen={(id) => navigate(`/book/${id}`)}
        />
      ) : layout === "collections" ? (
        <CollectionsList filter={needle} />
      ) : layout === "posters" ? (
        <div
          data-testid="library-grid"
          className={cn(
            "grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
            byLetter && gutter,
          )}
        >
          {items}
        </div>
      ) : (
        shown.length > 0 && (
          <div
            data-testid="library-list"
            className={cn("overflow-hidden rounded-2xl bg-card", byLetter && gutter)}
          >
            {items}
          </div>
        )
      )}
      {cards && shown.length === 0 && layout !== "collections" && layout !== "seasons" && (
        <EmptyState
          kind={kind}
          searching={needle !== ""}
          hiddenOnly={cards.length > 0 && visible.length === 0}
          onClearSearch={() => setQ("")}
          onShowUnmonitored={() => setPref(`unmonitored.${kind}`, "show")}
          onAdd={add}
          empty={cards.length === 0}
        />
      )}
      {byLetter && !selectMode && <LetterScrubber letters={[...anchors.values()]} />}
      {selectMode && (
        <LibraryBulkBar kind={kind} selected={checked} options={options} onDone={leaveSelect} />
      )}
      {menu && (
        <CardMenu kind={kind} app={config.app} target={menu} onClose={() => setMenu(null)} />
      )}
      {sortOpen && (
        <SortSheet
          options={config.sortKeys.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
          view={
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS_FOR[kind].map((l) => (
                <Button
                  key={l}
                  variant={layout === l ? "default" : "secondary"}
                  onClick={() => setPref(`layout.${kind}`, l)}
                >
                  {t(`library.layout.${l}`)}
                </Button>
              ))}
            </div>
          }
        >
          {kind === "books" && (
            <div className="mb-3 flex flex-wrap gap-2">
              {["", ...READING].map((status) => (
                <Button
                  key={status || "any"}
                  size="sm"
                  variant={readingFilter === status ? "default" : "secondary"}
                  className="rounded-full"
                  onClick={() => setReadingFilter(status)}
                >
                  {status ? t(`reading.${status}`) : t("reading.any")}
                </Button>
              ))}
            </div>
          )}
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

function LibraryItem({
  card,
  layout,
  anchor,
  dimmed,
  watched,
  progress,
  request,
  checked,
  onOpen,
  onMenu,
}: {
  card: Card;
  layout: Layout;
  anchor?: string;
  dimmed: boolean;
  watched: WatchedItem | undefined;
  /** 0–1 while in the download queue */
  progress?: number;
  request?: RequestState;
  /** undefined outside select mode */
  checked?: boolean;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const { t } = useTranslation();
  const press = useLongPress(onMenu);
  const { shouldClick, ...handlers } = press;
  const common = {
    type: "button" as const,
    id: anchor ? letterAnchor(anchor) : undefined,
    onClick: () => shouldClick() && onOpen(),
    ...handlers,
  };
  // long-pressing a cover would otherwise open iOS's image callout
  const noCallout = "select-none [-webkit-touch-callout:none]";
  const anchorMargin = "scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)]";
  const dot = (
    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[card.status])} />
  );
  const bar = progress !== undefined && (
    <div
      role="progressbar"
      aria-label={t("library.downloading")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="h-1 w-full overflow-hidden rounded-full bg-black/40"
    >
      <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
  );
  const tick = checked !== undefined && (
    <div
      className={cn(
        "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 text-xs text-white",
        checked ? "border-primary bg-primary" : "border-white/80 bg-black/30",
      )}
    >
      {checked ? "✓" : ""}
    </div>
  );

  if (layout === "posters")
    return (
      <button
        {...common}
        className={cn(
          focusRing,
          noCallout,
          anchorMargin,
          // no rounding and no paint containment on the card itself: both
          // clipped the subtitle's descenders. The cover has its own corners.
          "min-w-0 pb-1 text-left active:opacity-70",
        )}
      >
        <div className={cn("relative", dimmed && "opacity-40")}>
          <Cover src={card.poster} title={card.title} subtitle={card.subtitle} />
          {bar && <div className="absolute inset-x-2 bottom-2">{bar}</div>}
          {request && (
            <div className="absolute left-1.5 top-1.5">
              <RequestBadge request={request} />
            </div>
          )}
          {tick}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {dot}
          <span className="truncate text-sm font-medium">{card.title}</span>
          <WatchedDot item={watched} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{card.subtitle}</div>
      </button>
    );

  const details = layout === "details";
  return (
    <button
      {...common}
      className={cn(
        focusRing,
        noCallout,
        anchorMargin,
        "flex w-full items-center gap-3 border-t border-border px-3 py-2 text-left first:border-t-0 active:opacity-70",
        dimmed && "opacity-50",
      )}
    >
      <div className={cn("relative shrink-0", details ? "w-14" : "w-9")}>
        <Cover src={card.poster} title={card.title} compact={!details} />
        {tick}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{card.title}</span>
          <WatchedDot item={watched} />
          <RequestBadge request={request} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{card.subtitle}</div>
        {bar && <div className="mt-1 max-w-48">{bar}</div>}
        {details && (
          <>
            {card.detail && (
              <div className="truncate text-xs text-muted-foreground">{card.detail}</div>
            )}
            {card.added && (
              <div className="truncate text-[11px] text-muted-foreground/80">
                {t("library.addedAgo", { when: formatWhen(card.added) })}
              </div>
            )}
          </>
        )}
      </div>
      {dot}
    </button>
  );
}

function LoadingView({ layout }: { layout: Layout }) {
  if (layout === "posters")
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="w-full rounded-xl [aspect-ratio:2/3]" />
        ))}
      </div>
    );
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton
          key={i}
          className={cn("w-full rounded-xl", layout === "details" ? "h-24" : "h-14")}
        />
      ))}
    </div>
  );
}

/** Why the view is empty, and the one thing that fixes it. */
function EmptyState({
  kind,
  empty,
  searching,
  hiddenOnly,
  onClearSearch,
  onShowUnmonitored,
  onAdd,
}: {
  kind: LibraryKind;
  empty: boolean;
  searching: boolean;
  hiddenOnly: boolean;
  onClearSearch: () => void;
  onShowUnmonitored: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [message, action, onAction] = empty
    ? [t(`library.empty.${kind}`), t(`library.empty.add.${kind}`), onAdd]
    : hiddenOnly
      ? [
          t("library.empty.allUnmonitored"),
          t("library.empty.showUnmonitored"),
          onShowUnmonitored,
        ]
      : searching
        ? [t("manage.noMatches"), t("library.empty.clearSearch"), onClearSearch]
        : [t("manage.noMatches"), null, null];
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && onAction && (
        <Button variant="secondary" className="rounded-full" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
