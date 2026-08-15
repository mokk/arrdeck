import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "../api/format";
import type { CalendarItem } from "../api/types";
import { Card, EmptyNote, Row, StateBadge } from "../components/Blocks";
import { useCalendarRange } from "../hooks/queries";

function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const first = monthStart(offset);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const { data } = useCalendarRange(isoDay(first), daysInMonth);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of [...(data?.radarr?.data ?? []), ...(data?.sonarr?.data ?? [])]) {
      if (!item.date) continue;
      const day = item.date.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return map;
  }, [data]);

  // monday-first weekday of the 1st
  const leadingBlanks = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const monthLabel = first.toLocaleDateString(i18n.language, {
    month: "long",
    year: "numeric",
  });
  const todayIso = isoDay(new Date());
  const monthItems = useMemo(
    () =>
      [...(data?.radarr?.data ?? []), ...(data?.sonarr?.data ?? [])]
        .filter((c) => c.date)
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [data],
  );
  const listItems = selectedDay ? (byDay.get(selectedDay) ?? []) : monthItems;

  return (
    <>
      <div className="mb-4 mt-1 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-extrabold capitalize tracking-tight">{monthLabel}</h1>
        <div className="ml-auto flex gap-1">
          <Button
            variant="secondary"
            size="icon-sm"
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
            onClick={() => {
              setOffset(offset + 1);
              setSelectedDay(null);
            }}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day == null) return <div key={`b${i}`} />;
          const iso = isoDay(new Date(first.getFullYear(), first.getMonth(), day));
          const items = byDay.get(iso) ?? [];
          return (
            <button
              key={iso}
              className={cn(
                "flex min-h-16 flex-col items-center gap-1 rounded-xl bg-card p-1.5 text-xs active:opacity-70",
                selectedDay === iso && "ring-2 ring-primary",
                iso === todayIso && "font-bold text-primary",
              )}
              onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
            >
              {day}
              {items.length > 0 && (
                <span className="flex flex-wrap justify-center gap-0.5">
                  {items.slice(0, 4).map((item, j) => (
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
        })}
      </div>
      <Card>
        {listItems.length === 0 && <EmptyNote>{t("dash.nothingScheduled")}</EmptyNote>}
        {listItems.map((c, i) => (
          <Row key={i}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={c.app} />
                {c.release_type && <StateBadge state={t(`cal.${c.release_type}`)} raw />}
                {c.extra ?? ""}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
              {!selectedDay && <span>{formatDate(c.date)}</span>}
              {c.has_file && <StateBadge state="downloaded" />}
            </div>
          </Row>
        ))}
      </Card>
    </>
  );
}
