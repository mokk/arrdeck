/** The artist and album pages: albums grouped by type with their own
 * monitoring, an album's tracks with their files, and the searches. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars && "defaultValue" in vars) return String(vars.defaultValue);
      return vars ? `${key}:${Object.values(vars).join("/")}` : key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: "1" }),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { mutate, releases } = vi.hoisted(() => ({
  mutate: vi.fn(),
  releases: vi.fn(),
}));
const detail = vi.hoisted(() => ({
  artist: { data: undefined as unknown, error: undefined, isLoading: false },
  album: { data: undefined as unknown, error: undefined, isLoading: false },
}));

vi.mock("../hooks/queries", () => {
  const mutation = { mutate, isPending: false };
  return {
    useArtistDetail: () => detail.artist,
    useAlbumDetail: () => detail.album,
    useUpdateArtist: () => mutation,
    useRefreshArtist: () => mutation,
    useBulkSearchLibrary: () => mutation,
    useDeleteLibraryItem: () => mutation,
    useMonitorAlbum: () => mutation,
    useTriggerSearch: () => mutation,
    useDeleteTrackFiles: () => mutation,
    useOptions: () => ({ data: { quality_profiles: [], root_folders: [] } }),
    useTags: () => ({ data: [] }),
  };
});

vi.mock("../components/ReleasesSheet", () => ({
  ReleasesSheet: (props: { app: string; params: Record<string, number> }) => {
    releases(props);
    return null;
  },
}));

import AlbumPage from "./Album";
import ArtistPage from "./Artist";

const album = (over: Record<string, unknown>) => ({
  id: 1,
  title: "Geogaddi",
  album_type: "Album",
  year: 2002,
  monitored: true,
  track_count: 24,
  track_file_count: 3,
  secondary_types: [],
  ...over,
});

beforeEach(() => {
  mutate.mockClear();
  releases.mockClear();
  navigate.mockClear();
});

describe("artist page", () => {
  beforeEach(() => {
    detail.artist.data = {
      id: 1,
      name: "Boards of Canada",
      monitored: true,
      album_count: 3,
      track_count: 59,
      track_file_count: 21,
      slug: "69158f97",
      links: [{ name: "discogs", url: "https://www.discogs.com/artist/307" }],
      ratings: [{ source: "musicbrainz", value: 9.6, votes: 16 }],
      genres: ["Idm"],
      albums: [
        album({ id: 4, title: "Peel Session", album_type: "EP", year: 1998 }),
        album({}),
        album({ id: 3, title: "Twoism", album_type: "EP", monitored: false }),
        album({
          id: 5,
          title: "Music Has the Right to Children",
          track_count: 18,
          track_file_count: 18,
        }),
      ],
    };
  });

  it("groups albums by type, albums first", () => {
    render(<ArtistPage />);
    const albums = screen.getByText("Album (2)");
    const eps = screen.getByText("EP (2)");
    // albums come before EPs, whatever order Lidarr listed them in
    expect(albums.compareDocumentPosition(eps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("MusicBrainz ↗").closest("a")?.getAttribute("href")).toBe(
      "https://musicbrainz.org/artist/69158f97",
    );
  });

  it("opens an album, and monitors one without opening it", async () => {
    render(<ArtistPage />);
    fireEvent.click(screen.getByText("Twoism"));
    expect(navigate).toHaveBeenCalledWith("/album/3");
    navigate.mockClear();
    const row = screen.getByText("Twoism").closest("div.flex") as HTMLElement;
    fireEvent.click(row.querySelector("button") as HTMLElement);
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id: 3, monitored: true }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("searches every monitored album of the artist", async () => {
    render(<ArtistPage />);
    fireEvent.click(screen.getByText("add.searchNow"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith([1]));
  });
});

describe("album page", () => {
  beforeEach(() => {
    detail.album.data = {
      ...album({}),
      artist: "Boards of Canada",
      artist_id: 1,
      slug: "8183834a",
      media: [
        { number: 1, format: '12" Vinyl' },
        { number: 2, format: '12" Vinyl' },
      ],
      tracks: [
        {
          id: 69,
          medium: 1,
          number: "A1",
          absolute: 1,
          title: "Ready Lets Go",
          duration: 59,
          has_file: true,
          file_id: 7,
          quality: "FLAC",
          size: 2048,
        },
        {
          id: 80,
          medium: 2,
          number: "C1",
          absolute: 12,
          title: "Dawn Chorus",
          duration: 233,
          has_file: false,
        },
      ],
      history: [{ type: "imported", date: "2026-10-11T06:06:31Z" }],
    }; // fmt: skip
  });

  it("lists each side's tracks with the file's quality", () => {
    render(<AlbumPage />);
    expect(screen.getByText("Ready Lets Go")).toBeTruthy();
    expect(screen.getByText("Dawn Chorus")).toBeTruthy();
    expect(screen.getByText(/FLAC/)).toBeTruthy();
    expect(screen.getAllByText(/^album\.medium:/)).toHaveLength(2);
    expect(screen.getByText("Boards of Canada").getAttribute("href")).toBe("/artist/1");
  });

  it("deletes one track's file", async () => {
    render(<AlbumPage />);
    fireEvent.click(screen.getByLabelText("album.deleteTrackFile:Ready Lets Go"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(7));
  });

  it("searches the album, automatically and by hand", async () => {
    render(<AlbumPage />);
    fireEvent.click(screen.getByText("add.searchNow"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ app: "lidarr", id: 1 }));
    fireEvent.click(screen.getByText("releases.interactive"));
    expect(releases).toHaveBeenCalledWith(
      expect.objectContaining({ app: "lidarr", params: { albumId: 1 } }),
    );
  });
});
