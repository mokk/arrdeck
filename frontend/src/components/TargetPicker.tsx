import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, focusRing } from "@/lib/utils";
import {
  useArtistAlbums,
  useLibraryArtists,
  useLibraryBooks,
  useLibraryMovies,
  useLibrarySeries,
  useSeriesEpisodes,
} from "../hooks/queries";
import { EmptyNote } from "./Blocks";
import { Sheet } from "./Sheet";

export type Target = {
  movie_id?: number;
  series_id?: number;
  episode_ids?: number[];
  book_id?: number;
  album_id?: number;
  label: string;
};

const ROW =
  "block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60";

/** Points one unplaceable file at a library entry. Movies and books are a
 * single choice; series need a season and episode, and music an artist and
 * then one of their albums, so the sheet drills in rather than trying to list
 * everything in the library at once. Which track a file is, Lidarr works out
 * itself once it knows the album. */
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
  const movies = useLibraryMovies(app === "radarr");
  const shows = useLibrarySeries(app === "sonarr");
  const books = useLibraryBooks(app === "readarr");
  const episodes = useSeriesEpisodes(series?.id ?? 0, season);
  const [artist, setArtist] = useState<{ id: number; name: string } | null>(null);
  const artists = useLibraryArtists(app === "lidarr");
  const albums = useArtistAlbums(app === "lidarr" ? (artist?.id ?? null) : null);

  const match = (title: string | null | undefined) =>
    (title ?? "").toLowerCase().includes(q.toLowerCase());

  if (app === "radarr") {
    const shown = (movies.data ?? []).filter((m) => match(m.title)).slice(0, 60);
    return (
      <Sheet title={t("dl.pickMovie")} onClose={onClose}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("manage.filterMovies")}
        />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
          {shown.map((m) => (
            <button
              type="button"
              key={m.id}
              className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => onPick({ movie_id: m.id, label: `${m.title} (${m.year ?? "?"})` })}
            >
              {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (app === "readarr") {
    // an author's name finds their books too: that is how a shelf is browsed
    const shown = (books.data ?? [])
      .filter((b) => match(b.title) || match(b.author))
      .slice(0, 60);
    return (
      <Sheet title={t("dl.pickBook")} onClose={onClose}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("dl.filterBooks")}
        />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
          {shown.map((b) => (
            <button
              type="button"
              key={b.id}
              className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() =>
                onPick({
                  book_id: b.id,
                  label: [b.title, b.author].filter(Boolean).join(" — "),
                })
              }
            >
              {b.title} <span className="text-muted-foreground">{b.author ?? ""}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (app === "lidarr" && !artist) {
    const shown = (artists.data ?? []).filter((a) => match(a.name)).slice(0, 60);
    return (
      <Sheet title={t("dl.pickArtist")} onClose={onClose}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("dl.filterArtists")}
        />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {artists.isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
          {!artists.isLoading && shown.length === 0 && (
            <EmptyNote>{t("manage.noMatches")}</EmptyNote>
          )}
          {shown.map((a) => (
            <button
              type="button"
              key={a.id}
              className={cn(focusRing, ROW)}
              onClick={() => {
                setArtist({ id: a.id, name: a.name ?? "" });
                setQ("");
              }}
            >
              {a.name}{" "}
              <span className="text-muted-foreground">
                {t("dl.albumCount", { count: a.album_count ?? 0 })}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (app === "lidarr" && artist) {
    const shown = (albums.data ?? []).filter((a) => match(a.title));
    return (
      <Sheet title={artist.name} subtitle={t("dl.pickAlbum")} onClose={onClose}>
        <div className="mb-2 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setArtist(null);
              setQ("");
            }}
          >
            {t("common.back")}
          </Button>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("dl.filterAlbums")}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {albums.isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
          {!albums.isLoading && shown.length === 0 && (
            <EmptyNote>{t("manage.noMatches")}</EmptyNote>
          )}
          {shown.map((a) => (
            <button
              type="button"
              key={a.id}
              className={cn(focusRing, ROW)}
              onClick={() =>
                onPick({ album_id: a.id, label: `${artist.name} — ${a.title ?? ""}` })
              }
            >
              {a.title}{" "}
              <span className="text-muted-foreground">
                {[a.year, a.album_type, t("dl.trackCount", { count: a.track_count ?? 0 })]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
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
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("manage.filterSeries")}
        />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
          {shown.map((s) => (
            <button
              type="button"
              key={s.id}
              className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSeries(null);
            setSeason(null);
          }}
        >
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
            type="button"
            key={e.id}
            className="block w-full border-t border-border py-2 text-left text-sm first:border-t-0 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
