/** The series page used to show a title and season cards and nothing else, while
 * the movie page had a synopsis, badges, external links, a profile picker and
 * actions. These tests assert the two now carry the same furniture, so the gap
 * cannot quietly reopen when one page gains something. */
import { fireEvent, render, screen } from "@testing-library/react";
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
}));

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
const detail = vi.hoisted(() => ({
  movie: { data: undefined as unknown, error: undefined as unknown, isLoading: false },
  series: { data: undefined as unknown, error: undefined as unknown, isLoading: false },
}));

vi.mock("../hooks/queries", () => {
  const mutation = { mutate, isPending: false };
  return {
    useMovieDetail: () => detail.movie,
    useSeriesDetail: () => detail.series,
    useSeriesEpisodes: () => ({ data: [], isLoading: false }),
    useOptions: () => ({ data: { quality_profiles: [{ id: 4, name: "HD-1080p" }] } }),
    useServices: () => ({ data: [] }),
    useWatched: () => ({ data: undefined }),
    useUpdateLibraryItem: () => mutation,
    useDeleteLibraryItem: () => mutation,
    useTriggerSearch: () => mutation,
    useEpisodeMonitor: () => mutation,
    useEpisodeSearch: () => mutation,
    useSeasonMonitor: () => mutation,
    useSeasonSearch: () => mutation,
    useRenamePreview: () => ({ data: [], isLoading: false }),
    useRename: () => mutation,
  };
});

vi.mock("../components/RenameCard", () => ({ RenameCard: () => null }));
vi.mock("../components/ReleasesSheet", () => ({ ReleasesSheet: () => null }));

import MoviePage from "./Movie";
import SeriesPage from "./Series";

const MOVIE = {
  id: 1,
  title: "Dune",
  year: 2021,
  overview: "A noble family becomes embroiled in a war.",
  poster: "/p.jpg",
  status: "released",
  runtime: 155,
  monitored: true,
  has_file: true,
  size_on_disk: 8 * 1024 ** 3,
  quality_profile_id: 4,
  imdb_id: "tt1160419",
  tmdb_id: 438631,
  file: { quality: "Bluray-1080p", size: 8 * 1024 ** 3, resolution: "1920x1080" },
  history: [{ type: "imported", date: "2026-08-19T10:00:00Z" }],
};

const SERIES = {
  id: 1,
  title: "Tulsa King",
  year: 2022,
  overview: "A mafia capo is exiled to Oklahoma.",
  poster: "/p.jpg",
  status: "continuing",
  runtime: 40,
  monitored: true,
  size_on_disk: 19 * 1024 ** 3,
  quality_profile_id: 4,
  imdb_id: "tt16358384",
  tvdb_id: 413215,
  tmdb_id: 153312,
  network: "Paramount+",
  certification: "TV-MA",
  episode_count: 10,
  episode_file_count: 10,
  total_episode_count: 39,
  season_count: 4,
  history: [{ type: "imported", date: "2026-08-19T10:00:00Z" }],
  seasons: [
    { number: 1, monitored: true, episode_count: 9, episode_file_count: 9, size_on_disk: 1 },
  ],
};

beforeEach(() => {
  mutate.mockReset();
  navigate.mockReset();
  detail.movie = { data: MOVIE, error: undefined, isLoading: false };
  detail.series = { data: SERIES, error: undefined, isLoading: false };
});

const pages = [
  ["movie", () => <MoviePage />] as const,
  ["series", () => <SeriesPage />] as const,
];

describe.each(pages)("the %s detail page", (_name, Page) => {
  it("shows the synopsis", () => {
    render(<Page />);
    expect(screen.getByText(/embroiled in a war|exiled to Oklahoma/)).toBeTruthy();
  });

  it("shows the year beside the title", () => {
    render(<Page />);
    expect(screen.getByText(/2021|2022/)).toBeTruthy();
  });

  it("shows a poster", () => {
    const { container } = render(<Page />);
    expect(container.querySelector('img[src="/p.jpg"]')).toBeTruthy();
  });

  it("offers a quality profile picker", () => {
    render(<Page />);
    expect(screen.getByText("HD-1080p")).toBeTruthy();
  });

  it("offers monitor, search and delete", () => {
    render(<Page />);
    // getAllByText: the series page also carries a monitor toggle per season.
    expect(screen.getAllByText("add.unmonitor").length).toBeGreaterThan(0);
    expect(screen.getByText("add.searchNow")).toBeTruthy();
    expect(screen.getByText("dl.deleteEllipsis")).toBeTruthy();
  });

  it("links out to IMDb and TMDB", () => {
    const { container } = render(<Page />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("imdb.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("themoviedb.org"))).toBe(true);
  });

  it("shows recent history", () => {
    render(<Page />);
    expect(screen.getByText("dash.recentHistory")).toBeTruthy();
  });

  it("hides the history section when there is none", () => {
    detail.movie = { data: { ...MOVIE, history: [] }, error: undefined, isLoading: false };
    detail.series = { data: { ...SERIES, history: [] }, error: undefined, isLoading: false };
    render(<Page />);
    expect(screen.queryByText("dash.recentHistory")).toBeNull();
  });

  it("surfaces a load error", () => {
    detail.movie = { data: undefined, error: new Error("radarr down"), isLoading: false };
    detail.series = { data: undefined, error: new Error("sonarr down"), isLoading: false };
    render(<Page />);
    expect(screen.getByText(/radarr down|sonarr down/)).toBeTruthy();
  });
});

describe("what each page shows that the other cannot", () => {
  it("the series page links to TVDB, which a film has no entry in", () => {
    const { container } = render(<SeriesPage />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("thetvdb.com"))).toBe(true);
    expect(hrefs.some((h) => h.includes("themoviedb.org/tv/"))).toBe(true);
  });

  it("the series page shows network and per-episode runtime", () => {
    render(<SeriesPage />);
    expect(screen.getByText(/Paramount\+/)).toBeTruthy();
    expect(screen.getByText(/series\.perEpisode:40/)).toBeTruthy();
  });

  it("the series page reports episodes on disk in place of a single file", () => {
    render(<SeriesPage />);
    expect(screen.getByText("series.onDisk")).toBeTruthy();
    expect(screen.getByText("series.episodes:10/10")).toBeTruthy();
  });

  it("flags unaired episodes rather than skewing the ratio", () => {
    // 10 aired of 39 total: the denominator stays at what has aired, and the
    // total is reported separately.
    render(<SeriesPage />);
    expect(screen.getByText(/series\.totalEpisodes:39/)).toBeTruthy();
  });

  it("omits the unaired note once everything has aired", () => {
    detail.series = {
      data: { ...SERIES, total_episode_count: 10 },
      error: undefined,
      isLoading: false,
    };
    render(<SeriesPage />);
    expect(screen.queryByText(/series\.totalEpisodes/)).toBeNull();
  });

  it("the series-level monitor toggle targets the series, not a season", () => {
    render(<SeriesPage />);
    // The first toggle in the DOM is the series-level one, above the seasons.
    fireEvent.click(screen.getAllByText("add.unmonitor")[0]);
    expect(mutate).toHaveBeenCalledWith({ id: 1, monitored: false });
  });

  it("the series-level search targets sonarr and the series id", () => {
    render(<SeriesPage />);
    fireEvent.click(screen.getByText("add.searchNow"));
    expect(mutate).toHaveBeenCalledWith({ app: "sonarr", id: 1 });
  });

  it("asks before deleting, and offers both variants", () => {
    render(<SeriesPage />);
    fireEvent.click(screen.getByText("dl.deleteEllipsis"));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("add.deleteFromDisk")).toBeTruthy();
    expect(screen.getByText("add.removeFromLibrary")).toBeTruthy();
  });

  it("the movie page keeps its file card and interactive search", () => {
    render(<MoviePage />);
    expect(screen.getByText("movie.file")).toBeTruthy();
    expect(screen.getByText("Bluray-1080p")).toBeTruthy();
    expect(screen.getByText("releases.interactive")).toBeTruthy();
  });
});
