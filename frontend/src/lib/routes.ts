// Where a history row, an activity event or a queue item leads: the page of
// the title it belongs to. Lidarr's rows carry the album.
type Ids = {
  movie_id?: number | null;
  series_id?: number | null;
  book_id?: number | null;
  album_id?: number | null;
};

export function pageFor(item: Ids): string | null {
  if (item.movie_id) return `/movie/${item.movie_id}`;
  if (item.series_id) return `/series/${item.series_id}`;
  if (item.book_id) return `/book/${item.book_id}`;
  if (item.album_id) return `/album/${item.album_id}`;
  return null;
}

/** The page behind an app's library id: the movie, the series, the book or
 * the album (what Recently added, Wanted and the calendar carry). */
export const LIBRARY_ROUTE: Record<string, string> = {
  radarr: "movie",
  sonarr: "series",
  readarr: "book",
  lidarr: "album",
};
