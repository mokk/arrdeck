// The Books tab as a bookshelf: each series in reading order with the missing
// volumes showing as gaps, or every author's books side by side.
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import type { LibraryBook, SeriesBook, ShelfSeries } from "../../api/types";
import { useBookShelf } from "../../hooks/queries";
import { usePersistentState } from "../../hooks/usePersistentState";
import { EmptyNote, ErrorNote } from "../Blocks";
import { Completion } from "./Completion";
import { Cover } from "./Cover";

type Grouping = "series" | "authors";

const owned = (b: { has_file?: boolean | null; monitored?: boolean | null }) =>
  Boolean(b.has_file) || Boolean(b.monitored);

function Tile({
  book,
  position,
  onOpen,
}: {
  book: Pick<SeriesBook, "title" | "poster" | "has_file" | "monitored">;
  position?: string | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const gap = !owned(book);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(focusRing, "w-24 shrink-0 text-left active:opacity-70")}
      aria-label={gap ? t("shelf.missing", { title: book.title }) : (book.title ?? "")}
    >
      {gap ? (
        <div className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border p-2 text-center text-muted-foreground [aspect-ratio:2/3]">
          {position && <span className="text-lg font-bold">#{position}</span>}
          <span className="line-clamp-3 text-[11px] leading-tight">{book.title}</span>
        </div>
      ) : (
        <div className={cn("relative", !book.has_file && "opacity-60")}>
          <Cover src={book.poster} title={book.title ?? ""} />
          {position && (
            <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-[11px] font-bold text-white">
              #{position}
            </span>
          )}
        </div>
      )}
      <div className="mt-1 truncate text-xs">{book.title}</div>
    </button>
  );
}

function Shelf({
  title,
  subtitle,
  have,
  total,
  children,
}: {
  title: string;
  subtitle?: string | null;
  have?: number;
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {total != null && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {have} / {total}
            </span>
          )}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        {total != null && <Completion have={have ?? 0} total={total} />}
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {children}
      </div>
    </section>
  );
}

export function ShelfView({
  books,
  needle,
  onOpen,
}: {
  books: LibraryBook[];
  needle: string;
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [grouping, setGrouping] = usePersistentState<Grouping>("shelf.grouping", "series");
  const shelf = useBookShelf(grouping === "series");
  const matches = (...values: (string | null | undefined)[]) =>
    !needle || values.some((v) => (v ?? "").toLowerCase().includes(needle));

  const toggle = (
    <div className="mb-4 flex gap-1 rounded-full bg-secondary p-1" role="tablist">
      {(["series", "authors"] as Grouping[]).map((g) => (
        <button
          key={g}
          type="button"
          role="tab"
          aria-selected={grouping === g}
          onClick={() => setGrouping(g)}
          className={cn(
            focusRing,
            "flex-1 rounded-full py-1.5 text-sm font-medium",
            grouping === g ? "bg-card shadow-sm" : "text-muted-foreground",
          )}
        >
          {t(`shelf.by_${g}`)}
        </button>
      ))}
    </div>
  );

  if (grouping === "authors") {
    const byAuthor = new Map<string, LibraryBook[]>();
    for (const b of books) {
      if (!matches(b.title, b.author, b.series_title)) continue;
      const key = b.author ?? "—";
      byAuthor.set(key, [...(byAuthor.get(key) ?? []), b]);
    }
    const authors = [...byAuthor.entries()].sort(([a], [b]) => a.localeCompare(b));
    return (
      <>
        {toggle}
        {authors.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
        {authors.map(([author, list]) => (
          <Shelf
            key={author}
            title={author}
            subtitle={t("shelf.books", { count: list.length })}
          >
            {[...list]
              .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
              .map((b) => (
                <Tile key={b.id} book={b} onOpen={() => onOpen(b.id)} />
              ))}
          </Shelf>
        ))}
      </>
    );
  }

  const series = (shelf.data ?? []).filter((s: ShelfSeries) =>
    matches(s.title, s.author, ...(s.books ?? []).map((b) => b.title)),
  );
  return (
    <>
      {toggle}
      {shelf.error && <ErrorNote>{(shelf.error as Error).message}</ErrorNote>}
      {shelf.isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {shelf.data && series.length === 0 && <EmptyNote>{t("shelf.noSeries")}</EmptyNote>}
      {series.map((s) => {
        const list = s.books ?? [];
        return (
          <Shelf
            key={s.id}
            title={s.title ?? ""}
            subtitle={s.author}
            have={list.filter((b) => b.has_file).length}
            total={list.length}
          >
            {list.map((b) => (
              <Tile
                key={b.book_id}
                book={b}
                position={b.position}
                onOpen={() => onOpen(b.book_id)}
              />
            ))}
          </Shelf>
        );
      })}
    </>
  );
}
