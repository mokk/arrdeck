import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyNote } from "./Blocks";
import { Sheet } from "./Sheet";
import { useLibraryMovies, useLibrarySeries, useSeriesEpisodes } from "../hooks/queries";

export type Target = { movie_id?: number; series_id?: number; episode_ids?: number[]; label: string };

/** Points one unplaceable file at a library entry. Movies are a single choice;
 * series need a season and episode, so the sheet drills in rather than trying
 * to list every episode in the library at once. */
export function TargetPicker({
  app,
  onPick,
  onClose,
}: {
  app: string;
  onPick: (target: Target) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [series, setSeries] = useState<{ id: number; title: string } | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const movies = useLibraryMovies();
  const shows = useLibrarySeries();
  const episodes = useSeriesEpisodes(series?.id ?? 0, season);

  const match = (title: string | null | undefined) =>
    (title ?? "").toLowerCase().includes(q.toLowerCase());

  if (app === "radarr") {
    const shown = (movies.data ?? []).filter((m) => match(m.title)).slice(0, 60);
    return (
      <Sheet title={t("dl.pickMovie")} onClose={onClose}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("manage.filterMovies")} />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
          {shown.map((m) => (
            <button
              key={m.id}
              className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60"
              onClick={() => onPick({ movie_id: m.id, label: `${m.title} (${m.year ?? "?"})` })}
            >
              {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (!series) {
    const shown = (shows.data ?? []).filter((s) => match(s.title)).slice(0, 60);
    return (
      <Sheet title={t("dl.pickSeries")} onClose={onClose}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("manage.filterSeries")} />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
          {shown.map((s) => (
            <button
              key={s.id}
              className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60"
              onClick={() => setSeries({ id: s.id, title: s.title ?? "" })}
            >
              {s.title} <span className="text-muted-foreground">{s.year ?? ""}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={series.title} subtitle={t("dl.pickEpisode")} onClose={onClose}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => { setSeries(null); setSeason(null); }}>
          {t("common.back")}
        </Button>
        {/* seasons aren't listed anywhere cheap, so offer a plain number entry */}
        <Input
          className="w-24"
          inputMode="numeric"
          placeholder={t("dl.season")}
          value={season ?? ""}
          onChange={(e) => setSeason(e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {season == null && <EmptyNote>{t("dl.enterSeason")}</EmptyNote>}
        {season != null && (episodes.data ?? []).length === 0 && !episodes.isLoading && (
          <EmptyNote>{t("manage.noMatches")}</EmptyNote>
        )}
        {(episodes.data ?? []).map((e) => (
          <button
            key={e.id}
            className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60"
            onClick={() =>
              onPick({
                series_id: series.id,
                episode_ids: [e.id],
                label: `${series.title} S${String(season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`,
              })
            }
          >
            E{String(e.episode).padStart(2, "0")} {e.title}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
