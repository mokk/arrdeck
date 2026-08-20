import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { formatDate } from "../api/format";
import type { CalendarItem } from "../api/types";
import { Card, EmptyNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import { useRegisterSubnav } from "../components/subnav";
import { useCalendarRange } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type View = "month" | "week" | "agenda";

const AGENDA_DAYS = 14;

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday-first, matching the month grid's column order. */
function weekStart(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** The window to request, per view. Each view steps by its own unit, so the
 * offset means months, weeks or nothing depending on where you are. */
function range(view: View, offset: number): { start: Date; days: number } {
  const now = new Date();
  if (view === "month") {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { start: first, days: new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate() };
  }
  if (view === "week") {
    return { start: addDays(weekStart(now), offset * 7), days: 7 };
  }
  return { start: now, days: AGENDA_DAYS };
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = usePersistentState<View>("cal.view", "month");
  const [offset, setOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useRegisterSubnav(
    [
      { value: "month", label: t("cal.month") },
      { value: "week", label: t("cal.week") },
      { value: "agenda", label: t("cal.agenda") },
    ],
    view,
    (v) => {
      setView(v as View);
      setOffset(0);
      setSelectedDay(null);
    },
  );

  const { start, days } = range(view, offset);
  const { data } = useCalendarRange(isoDay(start), days);

  const items = useMemo(
    () =>
      [...(data?.radarr?.data ?? []), ...(data?.sonarr?.data ?? [])]
        .filter((c) => c.date)
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const day = (item.date ?? "").slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return map;
  }, [items]);

  const todayIso = isoDay(new Date());
  const stepUnit = view === "month" ? "cal.month" : "cal.week";

  const heading =
    view === "month"
      ? start.toLocaleDateString(i18n.language, { month: "long", year: "numeric" })
      : view === "week"
        ? `${start.toLocaleDateString(i18n.language, { day: "numeric", month: "short" })} – ${addDays(start, 6).toLocaleDateString(i18n.language, { day: "numeric", month: "short" })}`
        : t("cal.nextDays", { count: AGENDA_DAYS });

  const dayCell = (date: Date, tall: boolean) => {
    const iso = isoDay(date);
    const dayItems = byDay.get(iso) ?? [];
    return (
      <button
        key={iso}
        // the coloured dots alone don't say how much is on a day
        aria-label={`${date.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" })} — ${t("cal.itemCount", { count: dayItems.length })}`}
        className={cn(
          focusRing,
          "flex flex-col items-center gap-1 rounded-xl bg-card p-1.5 text-xs active:opacity-70",
          tall ? "min-h-16" : "min-h-20",
          selectedDay === iso && "ring-2 ring-primary",
          iso === todayIso && "font-bold text-primary",
        )}
        onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
      >
        {!tall && (
          <span className="text-[0.6rem] uppercase text-muted-foreground">
            {date.toLocaleDateString(i18n.language, { weekday: "short" })}
          </span>
        )}
        {date.getDate()}
        {dayItems.length > 0 && (
          <span aria-hidden="true" className="flex flex-wrap justify-center gap-0.5">
            {dayItems.slice(0, 4).map((item, j) => (
              <span
                key={j}
                className={cn(
                  "size-1.5 rounded-full",
                  item.has_file
                    ? "bg-success"
                    : item.app === "radarr"
                      ? "bg-warning"
                      : "bg-primary",
                )}
              />
            ))}
          </span>
        )}
      </button>
    );
  };

  const row = (c: CalendarItem, i: number, showDate: boolean) => (
    <Row key={`${c.title}-${c.date}-${i}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{c.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <StateBadge state={c.app} />
          {c.release_type && <StateBadge state={t(`cal.${c.release_type}`)} raw />}
          {c.extra ?? ""}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        {showDate && <span>{formatDate(c.date)}</span>}
        {c.has_file && <StateBadge state="downloaded" />}
      </div>
    </Row>
  );

  const listItems = selectedDay ? (byDay.get(selectedDay) ?? []) : items;

  return (
    <>
      <div className="mb-4 mt-1 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.back")}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="min-w-0 truncate text-2xl font-extrabold capitalize tracking-tight">
          {heading}
        </h1>
        {/* the agenda is always "from today", so stepping it makes no sense */}
        {view !== "agenda" && (
          <div className="ml-auto flex gap-1">
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={t("cal.previous", { unit: t(stepUnit) })}
              onClick={() => {
                setOffset(offset - 1);
                setSelectedDay(null);
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={t("cal.next", { unit: t(stepUnit) })}
              onClick={() => {
                setOffset(offset + 1);
                setSelectedDay(null);
              }}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {view === "month" && (
        <div className="mb-4 grid grid-cols-7 gap-1">
          {Array.from({ length: (start.getDay() + 6) % 7 }, (_, i) => (
            <div key={`blank${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) =>
            dayCell(new Date(start.getFullYear(), start.getMonth(), i + 1), true),
          )}
        </div>
      )}

      {view === "week" && (
        <div className="mb-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => dayCell(addDays(start, i), false))}
        </div>
      )}

      {view === "agenda" ? (
        // grouped by day rather than one flat list, so the next fortnight reads
        // as a schedule instead of a wall of rows
        [...byDay.entries()].length === 0 ? (
          <EmptyNote>{t("dash.nothingScheduled")}</EmptyNote>
        ) : (
          [...byDay.entries()].map(([day, dayItems]) => (
            <div key={day} className="mb-5">
              <SectionTitle>
                {new Date(`${day}T00:00:00`).toLocaleDateString(i18n.language, {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
                {day === todayIso && (
                  <span className="ml-2 font-normal text-primary">{t("cal.today")}</span>
                )}
              </SectionTitle>
              <Card>{dayItems.map((c, i) => row(c, i, false))}</Card>
            </div>
          ))
        )
      ) : (
        <Card>
          {listItems.length === 0 && <EmptyNote>{t("dash.nothingScheduled")}</EmptyNote>}
          {listItems.map((c, i) => row(c, i, !selectedDay))}
        </Card>
      )}
    </>
  );
}
