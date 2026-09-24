// The Shows tab's season grid: every show with its seasons as toggles, to set
// monitoring for many at once — tap a season, or "latest only" for a show.
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import type { SeasonGridRow } from "../../api/types";
import { useGridSeasonMonitor, useSeasonGrid } from "../../hooks/queries";
import { EmptyNote, ErrorNote } from "../Blocks";
import { Cover } from "./Cover";

export function SeasonGrid({
  needle,
  onOpen,
}: {
  needle: string;
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { data, error, isLoading } = useSeasonGrid(true);
  const monitor = useGridSeasonMonitor();
  const rows = (data ?? []).filter(
    (r) => !needle || (r.title ?? "").toLowerCase().includes(needle),
  );

  const latestOnly = (row: SeasonGridRow) => {
    const real = (row.seasons ?? []).filter((s) => s.number > 0);
    const latest = Math.max(...real.map((s) => s.number));
    for (const s of row.seasons ?? []) {
      const want = s.number === latest;
      if (s.monitored !== want)
        monitor.mutate({ seriesId: row.id, season: s.number, monitored: want });
    }
  };

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  if (isLoading) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex gap-3 border-t border-border px-3 py-2.5 first:border-t-0"
        >
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            className={cn(focusRing, "w-10 shrink-0 self-start active:opacity-70")}
            aria-label={row.title ?? ""}
          >
            <Cover src={row.poster} title={row.title ?? ""} compact />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
              <button
                type="button"
                onClick={() => latestOnly(row)}
                className={cn(
                  focusRing,
                  "shrink-0 rounded-md px-1.5 text-[11px] font-semibold text-primary",
                )}
              >
                {t("seasons.latestOnly")}
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(row.seasons ?? []).map((s) => (
                <button
                  className={cn(
                    focusRing,
                    "flex min-w-11 flex-col items-center rounded-lg border px-1.5 py-0.5 leading-tight",
                    s.monitored
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                  key={s.number}
                  type="button"
                  aria-pressed={s.monitored}
                  aria-label={t("seasons.toggle", {
                    season:
                      s.number === 0
                        ? t("series.specials")
                        : t("series.season", { n: s.number }),
                  })}
                  onClick={() =>
                    monitor.mutate({
                      seriesId: row.id,
                      season: s.number,
                      monitored: !s.monitored,
                    })
                  }
                >
                  <span className="text-xs font-bold">
                    {s.number === 0 ? t("seasons.specials") : `S${s.number}`}
                  </span>
                  <span
                    className={cn(
                      "text-[10px]",
                      s.total && (s.have ?? 0) >= s.total ? "text-success" : "",
                    )}
                  >
                    {s.have}/{s.total}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {rows.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
    </div>
  );
}
