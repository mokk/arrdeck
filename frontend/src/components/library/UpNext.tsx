// The Shows tab in airing order: what comes next and when, with how much of
// that season is on disk. Shows with nothing on the calendar fold away below.
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import { formatRelative } from "../../api/format";
import type { LibrarySeries } from "../../api/types";
import { Completion } from "./Completion";
import { Cover } from "./Cover";

const code = (season: number, episode: number) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

/** Airing shows first, soonest first; the rest by title. */
function splitUpNext(rows: LibrarySeries[]) {
  const airing = rows
    .filter((s) => s.next_episode?.air_date)
    .sort((a, b) =>
      String(a.next_episode?.air_date).localeCompare(String(b.next_episode?.air_date)),
    );
  const idle = rows
    .filter((s) => !s.next_episode?.air_date)
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  return { airing, idle };
}

function UpNextRow({ show, onOpen }: { show: LibrarySeries; onOpen: () => void }) {
  const { t } = useTranslation();
  const next = show.next_episode;
  const season = show.current_season;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        focusRing,
        "flex w-full items-center gap-3 border-t border-border px-3 py-2.5 text-left first:border-t-0 active:opacity-70",
      )}
    >
      <div className="w-12 shrink-0">
        <Cover src={show.poster} title={show.title ?? ""} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{show.title}</div>
        {next ? (
          <div className="truncate text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {code(next.season, next.episode)}
            </span>
            {next.title ? ` · ${next.title}` : ""}
          </div>
        ) : (
          <div className="truncate text-xs text-muted-foreground">
            {show.status === "ended" ? t("upnext.ended") : t("upnext.nothingScheduled")}
          </div>
        )}
        {season?.total ? (
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1">
              <Completion have={season.have ?? 0} total={season.total} />
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("upnext.season", {
                number: season.number,
                have: season.have,
                total: season.total,
              })}
            </span>
          </div>
        ) : null}
      </div>
      {next?.air_date && (
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
          {formatRelative(next.air_date)}
        </span>
      )}
    </button>
  );
}

export function UpNextView({
  rows,
  onOpen,
}: {
  rows: LibrarySeries[];
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [showIdle, setShowIdle] = useState(false);
  const { airing, idle } = splitUpNext(rows);
  return (
    <>
      {airing.length > 0 ? (
        <div className="overflow-hidden rounded-2xl bg-card">
          {airing.map((s) => (
            <UpNextRow key={s.id} show={s} onOpen={() => onOpen(s.id)} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t("upnext.noneAiring")}
        </p>
      )}
      {idle.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showIdle}
            onClick={() => setShowIdle(!showIdle)}
            className={cn(
              focusRing,
              "mb-2 mt-5 flex w-full items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
            )}
          >
            {t("upnext.idle", { count: idle.length })}
            <ChevronDown
              className={cn("size-4 transition-transform", showIdle && "rotate-180")}
            />
          </button>
          {showIdle && (
            <div className="overflow-hidden rounded-2xl bg-card">
              {idle.map((s) => (
                <UpNextRow key={s.id} show={s} onOpen={() => onOpen(s.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
