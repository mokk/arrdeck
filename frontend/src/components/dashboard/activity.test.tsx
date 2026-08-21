/** The dashboard is the home screen, and every card on it renders a
 * ServiceBlock. A dead upstream answers ok:false at HTTP 200, so "offline" and
 * "serving stale data" are ordinary render paths rather than error states —
 * these tests cover those alongside the happy one, plus the empty states that
 * are the difference between a card that explains itself and a blank one. */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const hooks = vi.hoisted(() => ({
  recent: { data: undefined as unknown },
  torrents: { data: undefined as unknown },
  queue: { data: undefined as unknown },
  calendar: { data: undefined as unknown },
  history: { data: undefined as unknown },
  indexers: { data: undefined as unknown },
}));

const { retry, forceImport } = vi.hoisted(() => ({ retry: vi.fn(), forceImport: vi.fn() }));

vi.mock("../../hooks/queries", () => ({
  useRecent: () => hooks.recent,
  useTorrentsSummary: () => hooks.torrents,
  useQueue: () => hooks.queue,
  useCalendar: () => hooks.calendar,
  useHistory: () => hooks.history,
  useIndexerStats: () => hooks.indexers,
  useBlocklistRetry: () => ({ mutate: retry, isPending: false }),
  useForceImport: () => ({ mutate: forceImport, isPending: false }),
}));

// The real sheet fetches import candidates of its own; all these tests need to
// know is that it was opened for the right item.
vi.mock("../../components/ImportSheet", () => ({
  ImportSheet: ({ app, itemId }: { app: string; itemId: number }) => (
    <div>{`import-sheet:${app}:${itemId}`}</div>
  ),
}));

import {
  CalendarSection,
  HistorySection,
  IndexerSection,
  QueueSection,
  RecentSection,
  TorrentSummary,
} from "./activity";

const ARRS = new Set(["radarr", "sonarr"]);

const healthy = <T,>(data: T) => ({ ok: true, data, error: null, stale_age_seconds: null });
const offline = (error: string) => ({ ok: false, data: null, error, stale_age_seconds: null });
const stale = <T,>(data: T, seconds: number) => ({
  ok: false,
  data,
  error: null,
  stale_age_seconds: seconds,
});

const torrent = (over: Record<string, unknown> = {}) => ({
  client: "qbittorrent",
  id: "t1",
  name: "Dune.2021.2160p",
  state: "downloading",
  progress: 0.5,
  size: 1024 ** 3,
  dl_speed: 2 * 1024 ** 2,
  ul_speed: 1024,
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  totals: { dl_speed: 3 * 1024 ** 2, ul_speed: 5 * 1024 },
  count: 12,
  active_count: 3,
  active: [torrent()],
  ...over,
});

const queueItem = (over: Record<string, unknown> = {}) => ({
  app: "radarr",
  id: 1,
  title: "Dune.2021.2160p",
  status: "downloading",
  size: 100,
  size_left: 25,
  time_left: "00:12:00",
  ...over,
});

const calendarItem = (over: Record<string, unknown> = {}) => ({
  app: "sonarr",
  title: "Severance S02E01",
  date: "2030-04-02T20:00:00Z",
  has_file: false,
  ...over,
});

const historyItem = (over: Record<string, unknown> = {}) => ({
  app: "radarr",
  title: "Dune.2021.2160p",
  date: "2026-08-19T10:00:00Z",
  events: [{ type: "grabbed", date: "2026-08-19T09:00:00Z" }],
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  navigate.mockReset();
  retry.mockReset();
  forceImport.mockReset();
  hooks.recent = { data: undefined };
  hooks.torrents = { data: undefined };
  hooks.queue = { data: undefined };
  hooks.calendar = { data: undefined };
  hooks.history = { data: undefined };
  hooks.indexers = { data: undefined };
});

describe("recently added", () => {
  it("renders nothing at all when nothing has been added", () => {
    hooks.recent = { data: [] };
    render(<RecentSection />);
    expect(screen.queryByText("dash.recentlyAdded")).toBeNull();
  });

  it("shows the title and subtitle of each new item", () => {
    hooks.recent = {
      data: [{ app: "sonarr", title: "Severance", subtitle: "S02E01", poster: "/p.jpg" }],
    };
    render(<RecentSection />);
    expect(screen.getByText("Severance")).toBeTruthy();
    expect(screen.getByText("S02E01")).toBeTruthy();
  });

  it("falls back to the title when the arr has no poster for it", () => {
    // A missing poster used to leave a blank tile, which reads as a broken
    // image rather than a title the arr has no artwork for yet.
    hooks.recent = { data: [{ app: "radarr", title: "Dune", poster: null }] };
    const { container } = render(<RecentSection />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText("Dune").length).toBeGreaterThan(0);
  });

  it("opens the series route for a Sonarr item and the movie route for a Radarr one", () => {
    hooks.recent = {
      data: [
        { app: "sonarr", title: "Severance", library_id: 7 },
        { app: "radarr", title: "Dune", library_id: 42 },
      ],
    };
    render(<RecentSection />);
    fireEvent.click(screen.getAllByText("Severance")[0]);
    expect(navigate).toHaveBeenCalledWith("/series/7");
    fireEvent.click(screen.getAllByText("Dune")[0]);
    expect(navigate).toHaveBeenCalledWith("/movie/42");
  });

  it("does not navigate for an item the arr has no library id for", () => {
    hooks.recent = { data: [{ app: "radarr", title: "Dune", library_id: null }] };
    render(<RecentSection />);
    fireEvent.click(screen.getAllByText("Dune")[0]);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("torrent activity", () => {
  it("renders nothing when no torrent client is configured", () => {
    hooks.torrents = { data: { qbittorrent: healthy(summary()) } };
    render(<TorrentSummary configured={new Set(["radarr"])} />);
    expect(screen.queryByText("dash.torrentActivity")).toBeNull();
  });

  it("shows each client's throughput and its active-of-total count", () => {
    hooks.torrents = { data: { qbittorrent: healthy(summary()) } };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText("3.0 MB/s")).toBeTruthy();
    expect(screen.getByText("5.0 KB/s")).toBeTruthy();
    expect(screen.getByText("dash.torrentCount:12/3")).toBeTruthy();
  });

  it("only renders the clients that are configured", () => {
    hooks.torrents = {
      data: { qbittorrent: healthy(summary()), transmission: healthy(summary()) },
    };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText(/qBittorrent/)).toBeTruthy();
    expect(screen.queryByText(/Transmission/)).toBeNull();
  });

  it("lists the active torrents with their state and progress", () => {
    hooks.torrents = { data: { qbittorrent: healthy(summary()) } };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText("Dune.2021.2160p")).toBeTruthy();
    expect(screen.getByText("downloading")).toBeTruthy();
    expect(screen.getByTitle("50%")).toBeTruthy();
  });

  it("collapses a client's torrents when its header is tapped", () => {
    hooks.torrents = { data: { qbittorrent: healthy(summary()) } };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    fireEvent.click(screen.getByText("▾ qBittorrent"));
    expect(screen.queryByText("Dune.2021.2160p")).toBeNull();
    // the totals stay, so a collapsed client still reports its throughput
    expect(screen.getByText("3.0 MB/s")).toBeTruthy();
  });

  it("remembers a collapsed client across a remount", () => {
    // The collapse is persisted, so someone who never watches qBittorrent
    // doesn't have to fold it away again on every visit to the dashboard.
    hooks.torrents = { data: { qbittorrent: healthy(summary()) } };
    const { unmount } = render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    fireEvent.click(screen.getByText("▾ qBittorrent"));
    unmount();

    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText("▸ qBittorrent")).toBeTruthy();
    expect(screen.queryByText("Dune.2021.2160p")).toBeNull();
  });

  it("says the client is offline rather than showing zero speeds", () => {
    // ok:false with no data arrives at HTTP 200; rendering the block anyway
    // would claim the client is idle when it is actually unreachable.
    hooks.torrents = { data: { qbittorrent: offline("connection refused") } };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText("common.offline — connection refused")).toBeTruthy();
    expect(screen.queryByText(/dash\.torrentCount/)).toBeNull();
  });

  it("keeps showing the last figures with their age when the client stops answering", () => {
    hooks.torrents = { data: { qbittorrent: stale(summary(), 300) } };
    render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    expect(screen.getByText("common.staleNote:5")).toBeTruthy();
    expect(screen.getByText("dash.torrentCount:12/3")).toBeTruthy();
  });

  it("shows a skeleton while the first response is in flight", () => {
    hooks.torrents = { data: undefined };
    const { container } = render(<TorrentSummary configured={new Set(["qbittorrent"])} />);
    // no accessible role to query, and the point of the skeleton is that the
    // card doesn't flash "offline" before the first response lands
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText(/common\.offline/)).toBeNull();
  });
});

describe("download queue", () => {
  it("stays hidden when the queue is empty and both arrs are up", () => {
    // A permanently visible "all good" card trains you to stop reading it.
    hooks.queue = { data: { radarr: healthy([]), sonarr: healthy([]) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.queryByText("dash.downloadQueue")).toBeNull();
  });

  it("merges the Radarr and Sonarr queues into one list", () => {
    hooks.queue = {
      data: {
        radarr: healthy([queueItem({ id: 1, title: "Dune" })]),
        sonarr: healthy([queueItem({ app: "sonarr", id: 2, title: "Severance" })]),
      },
    };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByText("Dune")).toBeTruthy();
    expect(screen.getByText("Severance")).toBeTruthy();
  });

  it("derives progress from the size still left to fetch", () => {
    hooks.queue = { data: { radarr: healthy([queueItem({ size: 100, size_left: 25 })]) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByTitle("75%")).toBeTruthy();
  });

  it("appears for an offline arr even with nothing queued", () => {
    hooks.queue = { data: { radarr: offline("radarr timed out"), sonarr: healthy([]) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByText("dash.serviceOffline:Radarr/radarr timed out")).toBeTruthy();
  });

  it("ignores an arr that is down but not configured", () => {
    // An unconfigured arr is expected to be unreachable; reporting it would
    // put a permanent error on the dashboard of anyone running only one arr.
    hooks.queue = { data: { radarr: offline("nope"), sonarr: healthy([]) } };
    render(<QueueSection configured={new Set(["sonarr"])} />);
    expect(screen.queryByText("dash.downloadQueue")).toBeNull();
  });

  it("still lists stale queue items while flagging the arr as offline", () => {
    hooks.queue = { data: { radarr: stale([queueItem({ title: "Dune" })], 120) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByText("Dune")).toBeTruthy();
    expect(screen.getByText(/dash\.serviceOffline:Radarr/)).toBeTruthy();
  });

  it("flags an item with errors as failed even while its status says downloading", () => {
    // The arr's own status keeps reading "downloading" after a failure, so the
    // badge has to come from the errors instead of the status field.
    hooks.queue = {
      data: {
        radarr: healthy([queueItem({ status: "downloading", errors: ["no space left"] })]),
      },
    };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.queryByText("downloading")).toBeNull();
  });

  it("prefers a tracked warning over the arr's status", () => {
    hooks.queue = {
      data: {
        radarr: healthy([queueItem({ status: "completed", tracked_status: "warning" })]),
      },
    };
    render(<QueueSection configured={ARRS} />);
    expect(screen.getByText("warning")).toBeTruthy();
  });

  it("offers a force import while the item is stuck importing", () => {
    hooks.queue = {
      data: { radarr: healthy([queueItem({ id: 5, tracked_state: "importPending" })]) },
    };
    render(<QueueSection configured={ARRS} />);
    fireEvent.click(screen.getByText("dl.forceImport"));
    expect(forceImport).toHaveBeenCalledWith({ app: "radarr", id: 5 });
  });

  it("drops the force import once the item is imported", () => {
    hooks.queue = { data: { radarr: healthy([queueItem({ tracked_state: "imported" })]) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.queryByText("dl.forceImport")).toBeNull();
  });

  it("offers a blocklist retry for an item that errored", () => {
    hooks.queue = {
      data: { radarr: healthy([queueItem({ id: 9, errors: ["hash mismatch"] })]) },
    };
    render(<QueueSection configured={ARRS} />);
    fireEvent.click(screen.getByText("dl.blocklistRetry"));
    expect(retry).toHaveBeenCalledWith({ app: "radarr", id: 9 });
  });

  it("offers no actions for an item that is simply downloading", () => {
    hooks.queue = { data: { radarr: healthy([queueItem()]) } };
    render(<QueueSection configured={ARRS} />);
    expect(screen.queryByText("dl.blocklistRetry")).toBeNull();
    expect(screen.queryByText("dl.manualImport")).toBeNull();
    expect(screen.queryByText("dl.forceImport")).toBeNull();
  });

  it("opens the manual import sheet for the item whose files the arr refused", () => {
    hooks.queue = {
      data: {
        radarr: healthy([queueItem({ id: 3, tracked_status: "warning" })]),
        sonarr: healthy([queueItem({ app: "sonarr", id: 4 })]),
      },
    };
    render(<QueueSection configured={ARRS} />);
    expect(screen.queryByText(/import-sheet/)).toBeNull();
    fireEvent.click(screen.getByText("dl.manualImport"));
    expect(screen.getByText("import-sheet:radarr:3")).toBeTruthy();
  });
});

describe("upcoming calendar", () => {
  it("says nothing is scheduled instead of rendering an empty card", () => {
    hooks.calendar = { data: { radarr: healthy([]), sonarr: healthy([]) } };
    render(<CalendarSection configured={ARRS} />);
    expect(screen.getByText("dash.nothingScheduled")).toBeTruthy();
  });

  it("orders both arrs' entries by date, with undated ones last", () => {
    // Radarr returns films with no confirmed digital date; sorting them by the
    // raw string would scatter them through the list instead of parking them.
    hooks.calendar = {
      data: {
        radarr: healthy([
          calendarItem({ app: "radarr", title: "Undated", date: null }),
          calendarItem({ app: "radarr", title: "Later", date: "2030-05-01T00:00:00Z" }),
        ]),
        sonarr: healthy([calendarItem({ title: "Sooner", date: "2030-04-01T00:00:00Z" })]),
      },
    };
    render(<CalendarSection configured={ARRS} />);
    const order = screen.getAllByText(/^(Sooner|Later|Undated)$/).map((el) => el.textContent);
    expect(order).toEqual(["Sooner", "Later", "Undated"]);
  });

  it("caps the card at 15 entries and points at the calendar page for the rest", () => {
    hooks.calendar = {
      data: {
        radarr: healthy(
          Array.from({ length: 20 }, (_, i) => calendarItem({ title: `Ep ${i}` })),
        ),
      },
    };
    const { container } = render(<CalendarSection configured={ARRS} />);
    expect(screen.getAllByText(/^Ep \d+$/)).toHaveLength(15);
    const seeAll = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(seeAll).toContain("/calendar");
  });

  it("marks an entry that is already on disk instead of dating it", () => {
    hooks.calendar = { data: { radarr: healthy([calendarItem({ has_file: true })]) } };
    render(<CalendarSection configured={ARRS} />);
    expect(screen.getByText("downloaded")).toBeTruthy();
  });

  it("shows the release type when the arr reports one", () => {
    hooks.calendar = {
      data: { radarr: healthy([calendarItem({ app: "radarr", release_type: "digital" })]) },
    };
    render(<CalendarSection configured={ARRS} />);
    expect(screen.getByText("cal.digital")).toBeTruthy();
  });

  it("reports a configured arr that is offline", () => {
    hooks.calendar = { data: { radarr: offline("radarr down"), sonarr: healthy([]) } };
    render(<CalendarSection configured={ARRS} />);
    expect(screen.getByText("dash.serviceOffline:Radarr/radarr down")).toBeTruthy();
  });

  it("stays quiet about an arr that is down but not configured", () => {
    hooks.calendar = { data: { radarr: offline("radarr down"), sonarr: healthy([]) } };
    render(<CalendarSection configured={new Set(["sonarr"])} />);
    expect(screen.queryByText(/dash\.serviceOffline/)).toBeNull();
  });
});

describe("recent history", () => {
  it("shows the newest event first across both arrs", () => {
    hooks.history = {
      data: {
        radarr: healthy([historyItem({ title: "Older", date: "2026-08-01T10:00:00Z" })]),
        sonarr: healthy([
          historyItem({ app: "sonarr", title: "Newer", date: "2026-08-20T10:00:00Z" }),
        ]),
      },
    };
    render(<HistorySection configured={ARRS} />);
    const order = screen.getAllByText(/^(Older|Newer)$/).map((el) => el.textContent);
    expect(order).toEqual(["Newer", "Older"]);
  });

  it("caps the card at 12 rows and links to the full history", () => {
    hooks.history = {
      data: {
        radarr: healthy(
          Array.from({ length: 18 }, (_, i) =>
            historyItem({
              title: `Grab ${i}`,
              date: `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
            }),
          ),
        ),
      },
    };
    const { container } = render(<HistorySection configured={ARRS} />);
    expect(screen.getAllByText(/^Grab \d+$/)).toHaveLength(12);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/history");
  });

  it("shows a badge per event so one release reads as one row", () => {
    hooks.history = {
      data: {
        radarr: healthy([
          historyItem({
            events: [
              { type: "grabbed", date: "2026-08-19T09:00:00Z" },
              { type: "imported", date: "2026-08-19T10:00:00Z" },
            ],
          }),
        ]),
      },
    };
    render(<HistorySection configured={ARRS} />);
    expect(screen.getByText("grabbed")).toBeTruthy();
    expect(screen.getByText("imported")).toBeTruthy();
  });

  it("opens the movie or series the event belongs to", () => {
    hooks.history = {
      data: {
        radarr: healthy([historyItem({ title: "Film", movie_id: 42 })]),
        sonarr: healthy([historyItem({ app: "sonarr", title: "Show", series_id: 7 })]),
      },
    };
    render(<HistorySection configured={ARRS} />);
    fireEvent.click(screen.getByText("Film"));
    expect(navigate).toHaveBeenCalledWith("/movie/42");
    fireEvent.click(screen.getByText("Show"));
    expect(navigate).toHaveBeenCalledWith("/series/7");
  });

  it("does not navigate from a row with no library item behind it", () => {
    // Deleted titles keep their history rows; those must not route to a page
    // that would fail to load.
    hooks.history = {
      data: { radarr: healthy([historyItem({ title: "Orphan", movie_id: null })]) },
    };
    render(<HistorySection configured={ARRS} />);
    fireEvent.click(screen.getByText("Orphan"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reports a configured arr that is offline", () => {
    hooks.history = { data: { radarr: healthy([]), sonarr: offline("sonarr down") } };
    render(<HistorySection configured={ARRS} />);
    expect(screen.getByText("dash.serviceOffline:Sonarr/sonarr down")).toBeTruthy();
  });
});

describe("indexers", () => {
  const stats = (over: Record<string, unknown> = {}) => ({
    enabled: 3,
    total: 5,
    health: [],
    stats: [{ name: "TorrentLeech", queries: 120, grabs: 7, avg_response_ms: 480 }],
    ...over,
  });

  it("shows how many indexers are enabled out of the total", () => {
    hooks.indexers = { data: healthy(stats()) };
    render(<IndexerSection />);
    expect(screen.getByText("3", { selector: "b" })).toBeTruthy();
    expect(screen.getByText(/\/5 manage\.enabled/)).toBeTruthy();
  });

  it("lists each indexer's queries, grabs and response time", () => {
    hooks.indexers = { data: healthy(stats()) };
    render(<IndexerSection />);
    expect(screen.getByText("TorrentLeech")).toBeTruthy();
    expect(screen.getByText("dash.queriesGrabs:120/7")).toBeTruthy();
    expect(screen.getByText("480 ms")).toBeTruthy();
  });

  it("carries a warning badge for each health problem Prowlarr reports", () => {
    hooks.indexers = {
      data: healthy(stats({ health: [{ message: "auth failed" }, { message: "no results" }] })),
    };
    render(<IndexerSection />);
    expect(screen.getAllByText("warning")).toHaveLength(2);
  });

  it("says Prowlarr is offline instead of reporting zero indexers", () => {
    hooks.indexers = { data: offline("prowlarr unreachable") };
    render(<IndexerSection />);
    expect(screen.getByText("common.offline — prowlarr unreachable")).toBeTruthy();
    expect(screen.queryByText(/manage\.enabled/)).toBeNull();
  });

  it("keeps the last known indexer stats with their age when Prowlarr drops out", () => {
    hooks.indexers = { data: stale(stats(), 3600) };
    render(<IndexerSection />);
    expect(screen.getByText("common.staleNote:60")).toBeTruthy();
    expect(screen.getByText("TorrentLeech")).toBeTruthy();
  });
});
