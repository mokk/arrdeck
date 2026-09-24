// Statistics → Watching: Plex's own play history — how much, who, what and
// when. Hours are an estimate: Plex does not record how long a play lasted, so
// each one counts the film's runtime or the show's usual episode length.
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import type { WatchTitle } from "../../api/types";
import { useWatchStats } from "../../hooks/queries";
import { usePersistentState } from "../../hooks/usePersistentState";
import { Card, EmptyNote, ErrorNote, Row, SectionTitle, Segmented } from "../Blocks";
import { Cover } from "../library/Cover";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

/** Bars without axes: the shape is the point, the peak is labelled. */
function Bars({ label, values, names }: { label: string; values: number[]; names: string[] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="mb-4 rounded-2xl bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {values.some((v) => v > 0) && (
          <span>{t("watching.busiest", { name: names[peak] })}</span>
        )}
      </div>
      <div className="flex h-20 items-end gap-1" aria-hidden="true">
        {values.map((v, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed buckets
            key={i}
            className={cn(
              "flex-1 rounded-t",
              i === peak && v > 0 ? "bg-primary" : "bg-primary/35",
            )}
            style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{names[0]}</span>
        <span>{names[names.length - 1]}</span>
      </div>
    </div>
  );
}

function TitleRow({ rows, kind }: { rows: WatchTitle[]; kind: "movie" | "series" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="-mx-4 mb-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {rows.map((r) => {
        const id = kind === "movie" ? r.movie_id : r.series_id;
        return (
          <button
            type="button"
            key={r.title}
            disabled={id == null}
            onClick={() => id != null && navigate(`/${kind}/${id}`)}
            className={cn(
              focusRing,
              "w-24 shrink-0 text-left active:opacity-70 disabled:opacity-100",
            )}
          >
            <Cover src={r.poster} title={r.title} />
            <div className="mt-1 truncate text-xs font-medium">{r.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {t("watching.plays", { count: r.plays ?? 0 })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function Watching() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = usePersistentState<string>("watching.days", "30");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { data: block, isLoading, error } = useWatchStats(Number(days), tz);
  const data = block?.data;
  const hours = (h: number) =>
    h.toLocaleString(i18n.language, { maximumFractionDigits: h < 10 ? 1 : 0 });
  // 1 January 2024 was a Monday, the server's first day
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(i18n.language, { weekday: "short" }),
  );
  const clock = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

  return (
    <>
      <Segmented
        options={[
          { value: "7", label: t("watching.days7") },
          { value: "30", label: t("stats.days30") },
          { value: "365", label: t("stats.days365") },
          { value: "0", label: t("watching.allTime") },
        ]}
        value={days}
        onChange={setDays}
      />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {block && !block.ok && <ErrorNote>{block.error}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && data.plays === 0 && <EmptyNote>{t("watching.nothing")}</EmptyNote>}
      {data && (data.plays ?? 0) > 0 && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Tile label={t("watching.playsLabel")} value={String(data.plays)} />
            <Tile label={t("watching.hours")} value={`≈ ${hours(data.hours ?? 0)}`} />
            <Tile label={t("dash.movies")} value={String(data.movies ?? 0)} />
            <Tile label={t("watching.episodes")} value={String(data.episodes ?? 0)} />
          </div>
          {(data.top_shows ?? []).length > 0 && (
            <>
              <SectionTitle>{t("watching.topShows")}</SectionTitle>
              <TitleRow rows={data.top_shows ?? []} kind="series" />
            </>
          )}
          {(data.top_movies ?? []).length > 0 && (
            <>
              <SectionTitle>{t("watching.topMovies")}</SectionTitle>
              <TitleRow rows={data.top_movies ?? []} kind="movie" />
            </>
          )}
          <Bars
            label={t("watching.byWeekday")}
            values={data.by_weekday ?? []}
            names={weekdays}
          />
          <Bars label={t("watching.byHour")} values={data.by_hour ?? []} names={clock} />
          {(data.users ?? []).length > 1 && (
            <>
              <SectionTitle>{t("watching.users")}</SectionTitle>
              <Card>
                {(data.users ?? []).map((u) => (
                  <Row key={u.name}>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {u.name}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t("watching.plays", { count: u.plays ?? 0 })} · ≈ {hours(u.hours ?? 0)} h
                    </span>
                  </Row>
                ))}
              </Card>
            </>
          )}
          <p className="mx-1 mb-6 text-xs text-muted-foreground">{t("watching.estimate")}</p>
        </>
      )}
    </>
  );
}
