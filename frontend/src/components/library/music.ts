// What the artist and album pages share: the links worth a chip, and how an
// album's progress reads.
import type { LibraryAlbum, MusicLink } from "../../api/types";
import type { ExternalLink } from "../detail";

// Lidarr lists every link MusicBrainz has (an artist easily has forty); these
// are the ones worth a chip, in this order.
const SITES: Record<string, string> = {
  discogs: "Discogs",
  allmusic: "AllMusic",
  last: "Last.fm",
  wikidata: "Wikidata",
  bandcamp: "Bandcamp",
  spotify: "Spotify",
  apple: "Apple Music",
  tidal: "Tidal",
  deezer: "Deezer",
};
const MAX_LINKS = 6;

/** MusicBrainz first (the id Lidarr knows them by), then the best-known sites. */
export function musicLinks(
  kind: "artist" | "release-group",
  slug: string | null | undefined,
  links: MusicLink[] | null | undefined,
): ExternalLink[] {
  const out: ExternalLink[] = [];
  if (slug) out.push({ label: "MusicBrainz", url: `https://musicbrainz.org/${kind}/${slug}` });
  for (const [name, label] of Object.entries(SITES)) {
    const link = (links ?? []).find((l) => l.name === name);
    if (link && out.length < MAX_LINKS) out.push({ label, url: link.url });
  }
  return out;
}

/** downloaded when every track is on disk, wanted while monitored and short. */
export function albumState(
  album: Pick<LibraryAlbum, "monitored" | "track_count" | "track_file_count">,
) {
  const have = album.track_file_count ?? 0;
  const total = album.track_count ?? 0;
  if (total > 0 && have >= total) return "downloaded";
  return album.monitored ? "wanted" : "unmonitored";
}

/** 4:05, or 1:02:09 past the hour. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
