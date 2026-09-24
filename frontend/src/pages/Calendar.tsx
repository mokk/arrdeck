// The calendar as one list: two weeks back, two months ahead, opened at today.
// Days carry a big date and how far away they are, months a divider, and each
// entry its cover, the app's colour, the air time and what kind of day it is —
// a finale, a digital release, already on disk.
import { CalendarPlus, Check, ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useNavigationType } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import type { CalendarItem } from "../api/types";
import { EmptyNote } from "../components/Blocks";
import { Cover } from "../components/library/Cover";
import { useCalendarRange } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";
import { usePref } from "../lib/prefs";

const STEP_DAYS = 30;
const BACK_DAYS = 14;
const AHEAD_DAYS = 60;

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const ROUTE: Record<CalendarItem["app"], string> = {
  radarr: "movie",
  sonarr: "series",
  readarr: "book",
};

const APP_LABEL: Record<CalendarItem["app"], string> = {
  radarr: "nav.movies",
  sonarr: "nav.shows",
  readarr: "nav.books",
};

// the theme's colours, so a palette recolours the stripes too
const STRIPE: Record<CalendarItem["app"], string> = {
  radarr: "bg-warning",
  sonarr: "bg-primary",
  readarr: "bg-success",
};

/** The local day an entry falls on. An episode's air time is a moment and can
 * cross midnight here; a film's or book's release is a date and must not. */
function dayOf(item: CalendarItem): string {
  if (!item.date) return "";
  if (item.app !== "sonarr") return item.date.slice(0, 10);
  return isoDay(new Date(item.date));
}

type Entry = CalendarItem & { count?: number; firstCode?: string };

/** A season dropped at once is one entry, not eight: same show, same day. */
function foldEpisodes(items: CalendarItem[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    const prev = out.find(
      (o) => o.app === "sonarr" && item.app === "sonarr" && o.item_id === item.item_id,
    );
    if (!prev) {
      out.push({ ...item, count: 1, firstCode: (item.extra ?? "").split(" ")[0] });
      continue;
    }
    const last = (item.extra ?? "").split(" ")[0];
    prev.count = (prev.count ?? 1) + 1;
    // S01E01 … S01E08 reads as S01E01–E08
    prev.extra = `${prev.firstCode}–${last.slice(last.indexOf("E"))}`;
    prev.has_file = prev.has_file && item.has_file;
    prev.finale_type = prev.finale_type ?? item.finale_type;
  }
  return out;
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const spoilers = usePref("spoilers");
  const [back, setBack] = useState(BACK_DAYS);
  const [ahead, setAhead] = useState(AHEAD_DAYS);
  const today = new Date();
  const todayIso = isoDay(today);
  const start = addDays(today, -back);
  const { data, isLoading } = useCalendarRange(isoDay(start), back + ahead);

  const [hiddenApps, setHiddenApps] = usePersistentState<string[]>("cal.hiddenApps", []);
  const [hideDownloaded, setHideDownloaded] = usePersistentState("cal.hideDownloaded", false);
  const apps = (["radarr", "sonarr", "readarr"] as const).filter((app) => data?.[app]);

  const days = useMemo(() => {
    const all = [
      ...(data?.radarr?.data ?? []),
      ...(data?.sonarr?.data ?? []),
      ...(data?.readarr?.data ?? []),
    ]
      .filter((c) => c.date)
      .filter((c) => !hiddenApps.includes(c.app) && !(hideDownloaded && c.has_file));
    const byDay = new Map<string, CalendarItem[]>();
    for (const item of all) byDay.set(dayOf(item), [...(byDay.get(dayOf(item)) ?? []), item]);
    // today is always there, so there is somewhere to open at
    if (!byDay.has(todayIso)) byDay.set(todayIso, []);
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, items]) => ({
        day,
        items: foldEpisodes(items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))),
      }));
  }, [data, hiddenApps, hideDownloaded, todayIso]);

  // Open at today once, when the list first has something to scroll through.
  // Coming back from a title restores where you were instead.
  const navigation = useNavigationType();
  const opened = useRef(navigation === "POP");
  const jumpToToday = (smooth = false) =>
    document
      .getElementById("cal-today")
      ?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    // after the shell's own scroll-to-top for a new page
    setTimeout(() => jumpToToday(), 0);
  }, [data]);

  const relative = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    const offset = Math.round(
      (new Date(y, m - 1, d).getTime() -
        new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
        86_400_000,
    );
    const text = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(
      offset,
      "day",
    );
    return text.charAt(0).toLocaleUpperCase(i18n.language) + text.slice(1);
  };

  const open = (c: CalendarItem) => {
    if (c.item_id != null) navigate(`/${ROUTE[c.app]}/${c.item_id}`);
  };

  let lastMonth = "";
  return (
    <>
      <div className="mb-3 mt-1 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.back")}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">
          {t("cal.title")}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("cal.subscribe")}
          title={t("cal.subscribe")}
          onClick={() => navigate("/settings/ical")}
        >
          <CalendarPlus className="size-5" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full"
          onClick={() => jumpToToday(true)}
        >
          {t("cal.jumpToday")}
        </Button>
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {apps.length > 1 &&
          apps.map((app) => {
            const on = !hiddenApps.includes(app);
            return (
              <Chip
                key={app}
                on={on}
                onClick={() =>
                  setHiddenApps(on ? [...hiddenApps, app] : hiddenApps.filter((a) => a !== app))
                }
              >
                <span
                  aria-hidden="true"
                  className={cn("mr-1.5 inline-block size-2 rounded-full", STRIPE[app])}
                />
                {t(APP_LABEL[app])}
              </Chip>
            );
          })}
        <Chip on={hideDownloaded} onClick={() => setHideDownloaded(!hideDownloaded)}>
          {t("cal.hideDownloaded")}
        </Chip>
      </div>

      {data && (
        <div className="mb-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setBack(back + STEP_DAYS)}>
            {t("cal.earlier")}
          </Button>
        </div>
      )}
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}

      {data &&
        days.map(({ day, items }) => {
          const [y, m, d] = day.split("-").map(Number);
          const date = new Date(y, m - 1, d);
          const month = date.toLocaleDateString(i18n.language, {
            month: "long",
            year: "numeric",
          });
          const newMonth = month !== lastMonth;
          lastMonth = month;
          const isToday = day === todayIso;
          const past = day < todayIso;
          return (
            <div key={day}>
              {newMonth && (
                <div className="mb-3 mt-6 flex items-center gap-3 first:mt-0">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {month}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <section
                id={isToday ? "cal-today" : undefined}
                aria-label={date.toLocaleDateString(i18n.language, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                className={cn(
                  "mb-4 flex scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)] gap-3",
                  past && "opacity-60",
                )}
              >
                <div
                  className={cn(
                    "flex w-12 shrink-0 flex-col items-center rounded-2xl py-1.5",
                    isToday ? "bg-primary text-primary-foreground" : "bg-card",
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase">
                    {date.toLocaleDateString(i18n.language, { weekday: "short" })}
                  </span>
                  <span className="text-xl font-extrabold leading-tight">{d}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "mb-1.5 text-xs font-semibold",
                      isToday ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {relative(day)}
                  </div>
                  {items.length === 0 ? (
                    <div className="rounded-xl bg-card px-3 py-2.5 text-sm text-muted-foreground">
                      {t("cal.nothingToday")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map((c, i) => (
                        <EntryRow
                          key={`${c.app}-${c.item_id}-${c.date}-${i}`}
                          item={c}
                          hideEpisodeTitle={spoilers !== "off"}
                          onOpen={() => open(c)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          );
        })}

      {data && (
        <div className="mb-2 mt-2 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setAhead(ahead + STEP_DAYS)}>
            {t("cal.later")}
          </Button>
        </div>
      )}
    </>
  );
}

function EntryRow({
  item,
  hideEpisodeTitle,
  onOpen,
}: {
  item: Entry;
  hideEpisodeTitle: boolean;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  // "S02E05 Love and Be Loved": the code always, the title unless spoilers say no
  const [code, ...rest] = (item.extra ?? "").split(" ");
  const folded = (item.count ?? 1) > 1;
  const subtitle =
    item.app === "sonarr"
      ? [
          code,
          folded
            ? t("cal.episodes", { count: item.count })
            : hideEpisodeTitle
              ? null
              : rest.join(" "),
        ]
          .filter(Boolean)
          .join(" · ")
      : item.extra;
  const time =
    item.app === "sonarr" && item.date
      ? new Date(item.date).toLocaleTimeString(i18n.language, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={item.item_id == null}
      className={cn(
        focusRing,
        "flex w-full items-center gap-3 overflow-hidden rounded-xl bg-card pr-3 text-left active:opacity-70",
      )}
    >
      <span aria-hidden="true" className={cn("w-1 self-stretch", STRIPE[item.app])} />
      <div className="w-9 shrink-0 py-2">
        <Cover src={item.poster} title={item.title} compact />
      </div>
      <div className="min-w-0 flex-1 py-2">
        <div className="truncate text-sm font-semibold">{item.title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        <div className="mt-1 flex flex-wrap gap-1">
          {item.finale_type && (
            <Badge className="bg-primary/15 text-primary">
              {t(`cal.finale_${item.finale_type}`)}
            </Badge>
          )}
          {item.release_type && (
            <Badge className="bg-warning/15 text-warning">
              {t(`cal.${item.release_type}`)}
            </Badge>
          )}
          {item.has_file && (
            <Badge className="bg-success/15 text-success">
              <Check className="mr-0.5 inline size-3" />
              {t("cal.onDisk")}
            </Badge>
          )}
        </div>
      </div>
      {time && (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
          {time}
        </span>
      )}
    </button>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        focusRing,
        "flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold",
        on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
