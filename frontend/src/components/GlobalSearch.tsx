// Search every library at once: ⌘K / Ctrl-K anywhere, or the magnifier on the
// library tabs. It reads the libraries already loaded for the tabs, so typing
// costs no request; "Search online" hands the words to the Add page.
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn, focusRing } from "@/lib/utils";
import {
  useLibraryBooks,
  useLibraryMovies,
  useLibrarySeries,
  useServices,
} from "../hooks/queries";
import { Cover } from "./library/Cover";
import { Sheet } from "./Sheet";

const OPEN_EVENT = "arrdeck:global-search";
const PER_GROUP = 6;

/** Opens the search from anywhere, without threading state through the tree. */
export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Hit = {
  key: string;
  group: "movies" | "shows" | "books" | "authors";
  title: string;
  subtitle?: string | null;
  poster?: string | null;
  to: string;
};

function rank(title: string, needle: string): number {
  const t = title.toLowerCase();
  if (t === needle) return 0;
  if (t.startsWith(needle)) return 1;
  if (t.split(/\s+/).some((w) => w.startsWith(needle))) return 2;
  return 3;
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { data: services } = useServices();
  const has = (s: string) => (services ?? []).some((sv) => sv.service === s && sv.configured);
  // only fetched once the search is opened; the tabs usually have them cached
  const movies = useLibraryMovies(open && has("radarr"));
  const series = useLibrarySeries(open && has("sonarr"));
  const books = useLibraryBooks(open && has("readarr"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // after the drawer's own focus handling
      setTimeout(() => input.current?.focus(), 50);
    }
  }, [open]);

  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (needle.length < 2) return [];
    const out: Hit[] = [];
    const take = (list: Hit[]) =>
      out.push(
        ...list
          .sort((a, b) => rank(a.title, needle) - rank(b.title, needle))
          .slice(0, PER_GROUP),
      );
    const matches = (...values: (string | null | undefined)[]) =>
      values.some((v) => (v ?? "").toLowerCase().includes(needle));
    take(
      (movies.data ?? [])
        .filter((m) => matches(m.title))
        .map((m) => ({
          key: `m${m.id}`,
          group: "movies",
          title: m.title ?? "",
          subtitle: m.year ? String(m.year) : null,
          poster: m.poster,
          to: `/movie/${m.id}`,
        })),
    );
    take(
      (series.data ?? [])
        .filter((s) => matches(s.title))
        .map((s) => ({
          key: `s${s.id}`,
          group: "shows",
          title: s.title ?? "",
          subtitle: s.year ? String(s.year) : null,
          poster: s.poster,
          to: `/series/${s.id}`,
        })),
    );
    take(
      (books.data ?? [])
        .filter((b) => matches(b.title, b.series_title))
        .map((b) => ({
          key: `b${b.id}`,
          group: "books",
          title: b.title ?? "",
          subtitle: b.author,
          poster: b.poster,
          to: `/book/${b.id}`,
        })),
    );
    const authors = new Map<number, string>();
    for (const b of books.data ?? [])
      if (b.author_id && b.author && matches(b.author)) authors.set(b.author_id, b.author);
    take(
      [...authors].map(([id, name]) => ({
        key: `a${id}`,
        group: "authors",
        title: name,
        to: `/author/${id}`,
      })),
    );
    return out;
  }, [needle, movies.data, series.data, books.data]);

  if (!open) return null;

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    navigate(hit.to);
  };
  const online = () => {
    setOpen(false);
    navigate(`/add?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <Sheet title={t("globalSearch.title")} onClose={() => setOpen(false)}>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-background/50 px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          type="search"
          enterKeyHint="go"
          aria-label={t("globalSearch.title")}
          placeholder={t("globalSearch.placeholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits.length) go(hits[active]);
              else if (needle) online();
            }
          }}
          className="h-11 w-full bg-transparent text-base outline-none md:text-sm"
        />
      </div>
      {needle.length >= 2 && hits.length === 0 && (
        <p className="px-1 pb-2 text-sm text-muted-foreground">{t("globalSearch.nothing")}</p>
      )}
      {hits.map((hit, i) => {
        const header = i === 0 || hits[i - 1].group !== hit.group;
        return (
          <div key={hit.key}>
            {header && (
              <div className="mb-1 mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                {t(`globalSearch.${hit.group}`)}
              </div>
            )}
            <button
              type="button"
              onClick={() => go(hit)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                focusRing,
                "flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left",
                i === active && "bg-secondary",
              )}
            >
              <div className="w-8 shrink-0">
                <Cover src={hit.poster} title={hit.title} compact />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{hit.title}</div>
                {hit.subtitle && (
                  <div className="truncate text-xs text-muted-foreground">{hit.subtitle}</div>
                )}
              </div>
            </button>
          </div>
        );
      })}
      {needle.length >= 2 && (
        <button
          type="button"
          onClick={online}
          className={cn(
            focusRing,
            "mt-3 w-full rounded-xl bg-secondary px-3 py-2.5 text-left text-sm font-medium text-primary",
          )}
        >
          {t("globalSearch.online", { q: q.trim() })}
        </button>
      )}
    </Sheet>
  );
}
