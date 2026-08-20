/** The movie and series lists were 76% duplicated and are now one component with
 * two configurations. These tests pin the behaviour that duplication used to
 * guarantee by accident: both lists filter, select and act the same way, and the
 * handful of real differences stay different. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      // StateBadge passes a defaultValue and leans on it for unknown states
      if (vars && "defaultValue" in vars) return String(vars.defaultValue);
      return vars ? `${key}:${Object.values(vars).join("/")}` : key;
    },
  }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const mutate = vi.fn();
const mutation = { mutate, isPending: false };
const hooks = vi.hoisted(() => ({
  movies: { data: undefined as unknown, error: undefined as unknown },
  series: { data: undefined as unknown, error: undefined as unknown },
  tags: { data: [] as { id: number; label: string }[] },
}));

vi.mock("../../../hooks/queries", () => ({
  useLibraryMovies: () => hooks.movies,
  useLibrarySeries: () => hooks.series,
  useOptions: () => ({ data: { quality_profiles: [{ id: 1, name: "HD-1080p" }] } }),
  useTags: () => hooks.tags,
  useServices: () => ({ data: [] }),
  useWatched: () => ({ data: undefined }),
  useTriggerSearch: () => mutation,
  useUpdateLibraryItem: () => mutation,
  useDeleteLibraryItem: () => mutation,
  useBulkLibrary: () => mutation,
  useBulkDeleteLibrary: () => mutation,
  useBulkSearchLibrary: () => mutation,
}));

import { SubnavProvider, useSubnav } from "../../subnav";
import { MovieLibrary } from "./movies";
import { SeriesLibrary } from "./series";

/** Stands in for the subnav's sort button. */
function SortOpener() {
  const { sortButton } = useSubnav();
  return (
    <button type="button" data-testid="open-sort" onClick={() => sortButton?.open()}>
      sort
    </button>
  );
}

const movie = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Dune",
  year: 2021,
  poster: "/p.jpg",
  tags: [],
  monitored: true,
  has_file: true,
  size_on_disk: 1024 ** 3,
  quality_profile_id: 1,
  ...over,
});

const show = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Severance",
  year: 2022,
  poster: "/p.jpg",
  tags: [],
  monitored: true,
  episode_file_count: 9,
  episode_count: 10,
  size_on_disk: 2 * 1024 ** 3,
  quality_profile_id: 1,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  navigate.mockReset();
  mutate.mockReset();
  hooks.tags = { data: [] };
  hooks.movies = { data: undefined, error: undefined };
  hooks.series = { data: undefined, error: undefined };
});

describe("movie library", () => {
  it("derives a status badge Radarr does not return", () => {
    hooks.movies = {
      data: [
        movie({ id: 1, title: "On disk", has_file: true }),
        movie({ id: 2, title: "Wanted", has_file: false, monitored: true }),
        movie({ id: 3, title: "Ignored", has_file: false, monitored: false }),
      ],
      error: undefined,
    };
    render(<MovieLibrary />);
    expect(screen.getByText("downloaded")).toBeTruthy();
    expect(screen.getByText("wanted")).toBeTruthy();
    expect(screen.getByText("unmonitored")).toBeTruthy();
  });

  it("offers Search only for a movie with no file", () => {
    hooks.movies = {
      data: [movie({ id: 1, title: "On disk", has_file: true })],
      error: undefined,
    };
    render(<MovieLibrary />);
    expect(screen.queryByText("common.search")).toBeNull();
  });

  it("offers Search once the file is missing", () => {
    hooks.movies = {
      data: [movie({ id: 2, title: "Missing", has_file: false })],
      error: undefined,
    };
    render(<MovieLibrary />);
    expect(screen.getByText("common.search")).toBeTruthy();
  });

  it("opens the movie route from the title", () => {
    hooks.movies = { data: [movie({ id: 42 })], error: undefined };
    render(<MovieLibrary />);
    fireEvent.click(screen.getByText(/Dune/));
    expect(navigate).toHaveBeenCalledWith("/movie/42");
  });

  it("surfaces a load error instead of an empty list", () => {
    hooks.movies = { data: undefined, error: new Error("radarr unreachable") };
    render(<MovieLibrary />);
    expect(screen.getByText("radarr unreachable")).toBeTruthy();
  });
});

describe("series library", () => {
  it("shows episode counts and monitored state rather than a derived status", () => {
    hooks.series = { data: [show()], error: undefined };
    render(<SeriesLibrary />);
    expect(screen.getByText(/manage\.episodes:9\/10/)).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("marks an unmonitored series paused", () => {
    hooks.series = { data: [show({ monitored: false })], error: undefined };
    render(<SeriesLibrary />);
    expect(screen.getByText("paused")).toBeTruthy();
  });

  it("always offers Search, unlike movies", () => {
    hooks.series = { data: [show()], error: undefined };
    render(<SeriesLibrary />);
    expect(screen.getByText("common.search")).toBeTruthy();
  });

  it("opens the series route from the title", () => {
    hooks.series = { data: [show({ id: 7 })], error: undefined };
    render(<SeriesLibrary />);
    fireEvent.click(screen.getByText(/Severance/));
    expect(navigate).toHaveBeenCalledWith("/series/7");
  });
});

describe("behaviour shared by both lists", () => {
  it("filters by tag, and All clears the filter", () => {
    hooks.tags = { data: [{ id: 5, label: "4k" }] };
    hooks.movies = {
      data: [movie({ id: 1, title: "Tagged", tags: [5] }), movie({ id: 2, title: "Untagged" })],
      error: undefined,
    };
    render(<MovieLibrary />);
    expect(screen.getByText("Tagged")).toBeTruthy();
    expect(screen.getByText("Untagged")).toBeTruthy();

    fireEvent.click(screen.getByText("4k"));
    expect(screen.getByText("Tagged")).toBeTruthy();
    expect(screen.queryByText("Untagged")).toBeNull();

    fireEvent.click(screen.getByText("manage.allTags"));
    expect(screen.getByText("Untagged")).toBeTruthy();
  });

  it("hides the tag chips when the arr has no tags", () => {
    hooks.movies = { data: [movie()], error: undefined };
    render(<MovieLibrary />);
    expect(screen.queryByText("manage.allTags")).toBeNull();
  });

  it("replaces per-row actions with the bulk bar in select mode", () => {
    // Two rows, because the bulk bar carries the same labels as a row does:
    // counting is the only way to tell the row actions from the bar's.
    hooks.series = { data: [show({ id: 1 }), show({ id: 2 })], error: undefined };
    render(<SeriesLibrary />);
    expect(screen.getAllByText("add.unmonitor")).toHaveLength(2);
    expect(screen.queryByText(/dl\.selected/)).toBeNull();

    fireEvent.click(screen.getByText("dl.select"));
    // per-row actions give way to the floating bulk bar, which has one of each
    expect(screen.getAllByText("add.unmonitor")).toHaveLength(1);
    expect(screen.getByText(/dl\.selected/)).toBeTruthy();
    expect(screen.getByText("dl.done")).toBeTruthy();
  });

  it("leaving select mode restores the row actions", () => {
    hooks.movies = { data: [movie({ has_file: false })], error: undefined };
    render(<MovieLibrary />);
    fireEvent.click(screen.getByText("dl.select"));
    fireEvent.click(screen.getByText("dl.done"));
    expect(screen.getByText("common.search")).toBeTruthy();
  });

  it("does not navigate when a row is tapped in select mode", () => {
    hooks.movies = { data: [movie({ id: 42 })], error: undefined };
    render(<MovieLibrary />);
    fireEvent.click(screen.getByText("dl.select"));
    fireEvent.click(screen.getByText(/Dune/));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("says so when a filter matches nothing", () => {
    hooks.movies = { data: [], error: undefined };
    render(<MovieLibrary />);
    expect(screen.getByText("manage.noMatches")).toBeTruthy();
  });

  it("toggles monitored through the same mutation on both lists", () => {
    hooks.movies = { data: [movie({ id: 3, monitored: true })], error: undefined };
    const { unmount } = render(<MovieLibrary />);
    fireEvent.click(screen.getByText("add.unmonitor"));
    expect(mutate).toHaveBeenCalledWith({ id: 3, monitored: false });
    unmount();

    mutate.mockReset();
    hooks.series = { data: [show({ id: 4, monitored: false })], error: undefined };
    render(<SeriesLibrary />);
    fireEvent.click(screen.getByText("add.monitor"));
    expect(mutate).toHaveBeenCalledWith({ id: 4, monitored: true });
  });

  it("offers each list its own sort keys", () => {
    // The sort button lives in the subnav, so open the sheet the way the app
    // does: through the registration the list makes on mount.
    hooks.series = { data: [show()], error: undefined };
    const { unmount } = render(
      <SubnavProvider>
        <SortOpener />
        <SeriesLibrary />
      </SubnavProvider>,
    );
    fireEvent.click(screen.getByTestId("open-sort"));
    expect(screen.getByText("manage.sort.episode_file_count")).toBeTruthy();
    expect(screen.getByText("manage.sort.size_on_disk")).toBeTruthy();
    unmount();

    hooks.movies = { data: [movie()], error: undefined };
    render(
      <SubnavProvider>
        <SortOpener />
        <MovieLibrary />
      </SubnavProvider>,
    );
    fireEvent.click(screen.getByTestId("open-sort"));
    // episode counts are meaningless for a movie
    expect(screen.queryByText("manage.sort.episode_file_count")).toBeNull();
    expect(screen.getByText("manage.sort.size_on_disk")).toBeTruthy();
  });
});
