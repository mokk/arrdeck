/** The status cards each answer one question — is anything playing, is anything
 * broken, is the disk full, is the VPN up — and each of them is fed a
 * ServiceBlock that says ok:false at HTTP 200 when its upstream is dead. These
 * tests pin the three render paths per card (healthy, offline, stale) and the
 * "hide rather than show an empty card" rule, which is what keeps the dashboard
 * readable when half the stack is unconfigured. */
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

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const hooks = vi.hoisted(() => ({
  sessions: { data: undefined as unknown },
  health: { data: undefined as unknown },
  requests: { data: undefined as unknown },
  disks: { data: undefined as unknown },
  vpn: { data: undefined as unknown },
  subtitles: { data: undefined as unknown },
  stats: { data: undefined as unknown },
  enabled: { sessions: true, health: true, requests: true, disks: true, vpn: true, subs: true },
}));

const { requestAction, subtitleSearch } = vi.hoisted(() => ({
  requestAction: vi.fn(),
  subtitleSearch: vi.fn(),
}));

// Each of these hooks takes an `enabled` flag derived from what is configured;
// recording it is the only way to prove the card doesn't poll a service the
// user hasn't set up.
vi.mock("../../hooks/queries", () => ({
  usePlaySessions: (enabled: boolean) => {
    hooks.enabled.sessions = enabled;
    return hooks.sessions;
  },
  useHealth: (enabled: boolean) => {
    hooks.enabled.health = enabled;
    return hooks.health;
  },
  useMediaRequests: (enabled: boolean) => {
    hooks.enabled.requests = enabled;
    return hooks.requests;
  },
  useDiskSpace: (enabled: boolean) => {
    hooks.enabled.disks = enabled;
    return hooks.disks;
  },
  useVpn: (enabled: boolean) => {
    hooks.enabled.vpn = enabled;
    return hooks.vpn;
  },
  useSubtitles: (enabled: boolean) => {
    hooks.enabled.subs = enabled;
    return hooks.subtitles;
  },
  useStatsHistory: () => hooks.stats,
  useRequestAction: () => ({ mutate: requestAction, isPending: false }),
  useSubtitleSearch: () => ({ mutate: subtitleSearch, isPending: false }),
}));

import {
  HealthSection,
  NowPlayingSection,
  RequestsSection,
  StorageSection,
  SubtitlesSection,
  TrendsSection,
  VpnSection,
} from "./cards";

const healthy = <T,>(data: T) => ({ ok: true, data, error: null, stale_age_seconds: null });
const offline = (error: string) => ({ ok: false, data: null, error, stale_age_seconds: null });
const stale = <T,>(data: T, seconds: number) => ({
  ok: false,
  data,
  error: null,
  stale_age_seconds: seconds,
});

const session = (over: Record<string, unknown> = {}) => ({
  title: "Dune",
  subtitle: "2021",
  user: "mads",
  player: "Apple TV",
  state: "playing",
  progress: 0.4,
  transcoding: false,
  ...over,
});

const request = (over: Record<string, unknown> = {}) => ({
  id: 11,
  type: "movie",
  status: 1,
  title: "Dune",
  year: "2021",
  requested_by: "mads",
  ...over,
});

const sample = (over: Record<string, unknown> = {}) => ({
  ts: 1,
  movies: 10,
  series: 4,
  library_bytes: 1024 ** 4,
  indexer_grabs: 3,
  ...over,
});

beforeEach(() => {
  requestAction.mockReset();
  subtitleSearch.mockReset();
  hooks.sessions = { data: undefined };
  hooks.health = { data: undefined };
  hooks.requests = { data: undefined };
  hooks.disks = { data: undefined };
  hooks.vpn = { data: undefined };
  hooks.subtitles = { data: undefined };
  hooks.stats = { data: undefined };
});

describe("now playing", () => {
  it("disappears entirely when nothing is playing", () => {
    hooks.sessions = { data: healthy([]) };
    render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.queryByText("dash.nowPlaying")).toBeNull();
  });

  it("does not query Plex at all when Plex is not configured", () => {
    hooks.sessions = { data: healthy([session()]) };
    render(<NowPlayingSection configured={new Set(["radarr"])} />);
    expect(hooks.enabled.sessions).toBe(false);
    expect(screen.queryByText("dash.nowPlaying")).toBeNull();
  });

  it("names what is playing, who is watching and on what", () => {
    hooks.sessions = { data: healthy([session()]) };
    render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.getByText("Dune")).toBeTruthy();
    expect(screen.getByText("2021")).toBeTruthy();
    expect(screen.getByText(/mads/)).toBeTruthy();
    expect(screen.getByText(/Apple TV/)).toBeTruthy();
    expect(screen.getByTitle("40%")).toBeTruthy();
  });

  it("distinguishes a paused session from a playing one", () => {
    hooks.sessions = {
      data: healthy([
        session({ title: "Playing" }),
        session({ title: "Held", state: "paused" }),
      ]),
    };
    render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.getByText("paused")).toBeTruthy();
    // Not "downloading": the badge was picked for its colour, but the word is
    // what the user reads, and nothing is being downloaded.
    expect(screen.getByText("playing")).toBeTruthy();
    expect(screen.queryByText("downloading")).toBeNull();
  });

  it("calls out a transcode, which is the expensive case worth noticing", () => {
    hooks.sessions = { data: healthy([session({ transcoding: true })]) };
    render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.getByText(/dash\.transcoding/)).toBeTruthy();
  });

  it("only offers the Plex deep link when the session carries a url", () => {
    hooks.sessions = { data: healthy([session({ url: null })]) };
    const { unmount } = render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.queryByText("dash.openInPlex")).toBeNull();
    unmount();

    hooks.sessions = { data: healthy([session({ url: "https://plex.tv/web/x" })]) };
    const { container } = render(<NowPlayingSection configured={new Set(["plex"])} />);
    expect(screen.getByText("dash.openInPlex")).toBeTruthy();
    expect(container.querySelector('a[href="https://plex.tv/web/x"]')).toBeTruthy();
  });
});

describe("health warnings", () => {
  it("shows nothing when the arrs report no warnings", () => {
    // A card that says "no problems" every day stops being read.
    hooks.health = { data: healthy([]) };
    render(<HealthSection configured={new Set(["radarr"])} />);
    expect(screen.queryByText("dash.health")).toBeNull();
  });

  it("does not query health when neither arr is configured", () => {
    hooks.health = { data: healthy([{ app: "radarr", level: "warning", message: "x" }]) };
    render(<HealthSection configured={new Set(["plex"])} />);
    expect(hooks.enabled.health).toBe(false);
    expect(screen.queryByText("dash.health")).toBeNull();
  });

  it("shows the warning message and which arr raised it", () => {
    hooks.health = {
      data: healthy([
        { app: "sonarr", level: "warning", message: "Indexers unavailable due to failures" },
      ]),
    };
    render(<HealthSection configured={new Set(["sonarr"])} />);
    expect(screen.getByText("Indexers unavailable due to failures")).toBeTruthy();
    expect(screen.getByText("sonarr")).toBeTruthy();
    expect(screen.getByText("warning")).toBeTruthy();
  });

  it("separates an error from a warning so the urgent one is visible", () => {
    hooks.health = {
      data: healthy([
        { app: "radarr", level: "error", message: "Download client unavailable" },
        { app: "radarr", level: "warning", message: "Branch is not a valid release" },
      ]),
    };
    render(<HealthSection configured={new Set(["radarr"])} />);
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.getByText("warning")).toBeTruthy();
  });
});

describe("pending requests", () => {
  it("hides itself when no one is waiting on anything", () => {
    hooks.requests = { data: healthy([]) };
    render(<RequestsSection configured={new Set(["overseerr"])} />);
    expect(screen.queryByText("dash.requests")).toBeNull();
  });

  it("does not query Overseerr when it is not configured", () => {
    hooks.requests = { data: healthy([request()]) };
    render(<RequestsSection configured={new Set(["radarr"])} />);
    expect(hooks.enabled.requests).toBe(false);
    expect(screen.queryByText("dash.requests")).toBeNull();
  });

  it("shows the title, year and who asked for it", () => {
    hooks.requests = { data: healthy([request()]) };
    render(<RequestsSection configured={new Set(["overseerr"])} />);
    expect(screen.getByText(/Dune/)).toBeTruthy();
    expect(screen.getByText("(2021)")).toBeTruthy();
    expect(screen.getByText(/mads/)).toBeTruthy();
  });

  it("shows the poster when Overseerr has one, and no broken image when it does not", () => {
    hooks.requests = { data: healthy([request({ poster: "/poster.jpg" })]) };
    const { container, unmount } = render(
      <RequestsSection configured={new Set(["overseerr"])} />,
    );
    expect(container.querySelector('img[src="/poster.jpg"]')).toBeTruthy();
    unmount();

    hooks.requests = { data: healthy([request({ poster: null })]) };
    const second = render(<RequestsSection configured={new Set(["overseerr"])} />);
    expect(second.container.querySelector("img")).toBeNull();
  });

  it("falls back to the request id when Overseerr has no title yet", () => {
    // A request for a title TMDB hasn't resolved would otherwise be a blank row
    // with two buttons and no way to tell what it is.
    hooks.requests = { data: healthy([request({ id: 77, title: "" })]) };
    render(<RequestsSection configured={new Set(["overseerr"])} />);
    expect(screen.getByText(/#77/)).toBeTruthy();
  });

  it("counts the seasons of a series request", () => {
    hooks.requests = { data: healthy([request({ type: "tv", seasons: [1, 2, 3] })]) };
    render(<RequestsSection configured={new Set(["overseerr"])} />);
    expect(screen.getByText(/dash\.seasonCount:3/)).toBeTruthy();
    // a tv request is destined for Sonarr, and says so
    expect(screen.getByText("sonarr")).toBeTruthy();
  });

  it("approves and declines the request that was acted on", () => {
    hooks.requests = { data: healthy([request({ id: 5 })]) };
    render(<RequestsSection configured={new Set(["overseerr"])} />);
    fireEvent.click(screen.getByText("dash.approve"));
    expect(requestAction).toHaveBeenCalledWith({ id: 5, action: "approve" });
    fireEvent.click(screen.getByText("dash.decline"));
    expect(requestAction).toHaveBeenCalledWith({ id: 5, action: "decline" });
  });
});

describe("storage", () => {
  it("does not query disk space when neither arr is configured", () => {
    render(<StorageSection configured={new Set(["plex"])} />);
    expect(hooks.enabled.disks).toBe(false);
    expect(screen.queryByText("dash.storage")).toBeNull();
  });

  it("shows free space per path", () => {
    hooks.disks = {
      data: healthy([
        {
          path: "/media",
          label: "media",
          free_bytes: 2 * 1024 ** 4,
          total_bytes: 8 * 1024 ** 4,
        },
      ]),
    };
    render(<StorageSection configured={new Set(["radarr"])} />);
    expect(screen.getByText("/media")).toBeTruthy();
    expect(screen.getByText("dash.freeSpace:2.0 TB")).toBeTruthy();
    expect(screen.getByText("8.0 TB")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByTitle("75%")).toBeTruthy();
  });

  it("omits the usage bar for a root folder that reports no total", () => {
    // A bar drawn from a missing total reads as 100% used, which is a false
    // alarm about a disk that simply didn't report its size.
    hooks.disks = { data: healthy([{ path: "/movies", free_bytes: 1024 ** 3 }]) };
    render(<StorageSection configured={new Set(["radarr"])} />);
    expect(screen.getByText("dash.freeSpace:1.0 GB")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says the arr is offline rather than implying the disks are empty", () => {
    hooks.disks = { data: offline("radarr unreachable") };
    render(<StorageSection configured={new Set(["radarr"])} />);
    expect(screen.getByText("common.offline — radarr unreachable")).toBeTruthy();
  });

  it("keeps the last known figures with their age when the arr drops out", () => {
    hooks.disks = { data: stale([{ path: "/media", free_bytes: 1024 ** 3 }], 900) };
    render(<StorageSection configured={new Set(["radarr"])} />);
    expect(screen.getByText("common.staleNote:15")).toBeTruthy();
    expect(screen.getByText("/media")).toBeTruthy();
  });

  it("shows a skeleton before the first response instead of an empty card", () => {
    const { container } = render(<StorageSection configured={new Set(["radarr"])} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("vpn", () => {
  it("does not query gluetun when it is not configured", () => {
    render(<VpnSection configured={new Set(["radarr"])} />);
    expect(hooks.enabled.vpn).toBe(false);
    expect(screen.queryByText("dash.vpn")).toBeNull();
  });

  it("shows the exit ip and location while the tunnel is up", () => {
    hooks.vpn = {
      data: healthy({
        status: "running",
        public_ip: "1.2.3.4",
        city: "Copenhagen",
        country: "Denmark",
        forwarded_port: 51413,
        port_matches: true,
      }),
    };
    render(<VpnSection configured={new Set(["gluetun"])} />);
    expect(screen.getByText("1.2.3.4")).toBeTruthy();
    expect(screen.getByText("Copenhagen, Denmark")).toBeTruthy();
    expect(screen.getByText("dash.forwardedPort:51413")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("marks the tunnel down when gluetun is not running", () => {
    hooks.vpn = { data: healthy({ status: "stopped", public_ip: "" }) };
    render(<VpnSection configured={new Set(["gluetun"])} />);
    expect(screen.getByText("error")).toBeTruthy();
    // an empty ip would collapse the row; the dash keeps its place
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("warns when the forwarded port is not the one the client listens on", () => {
    // A forwarded port the torrent client isn't bound to is silently
    // unconnectable: everything looks fine and nothing seeds.
    hooks.vpn = {
      data: healthy({
        status: "running",
        public_ip: "1.2.3.4",
        forwarded_port: 51413,
        client_port: 6881,
        port_matches: false,
      }),
    };
    render(<VpnSection configured={new Set(["gluetun"])} />);
    expect(screen.getByText("dash.portMismatch:6881")).toBeTruthy();
    expect(screen.getByText("warning")).toBeTruthy();
  });

  it("keeps quiet about the port when gluetun cannot tell either way", () => {
    hooks.vpn = {
      data: healthy({ status: "running", public_ip: "1.2.3.4", port_matches: null }),
    };
    render(<VpnSection configured={new Set(["gluetun"])} />);
    expect(screen.queryByText(/dash\.portMismatch/)).toBeNull();
    expect(screen.getByText("dash.forwardedPort:—")).toBeTruthy();
  });

  it("says gluetun is offline rather than reporting the tunnel as down", () => {
    // "container unreachable" and "tunnel down" are different problems and the
    // fix for each is different.
    hooks.vpn = { data: offline("gluetun api refused") };
    render(<VpnSection configured={new Set(["gluetun"])} />);
    expect(screen.getByText("common.offline — gluetun api refused")).toBeTruthy();
    expect(screen.queryByText("error")).toBeNull();
  });
});

describe("subtitles", () => {
  it("does not query Bazarr when it is not configured", () => {
    render(<SubtitlesSection configured={new Set(["radarr"])} />);
    expect(hooks.enabled.subs).toBe(false);
    expect(screen.queryByText("dash.subtitles")).toBeNull();
  });

  it("hides itself when nothing is missing subtitles", () => {
    hooks.subtitles = { data: healthy({ episodes: 0, movies: 0, providers: 4, items: [] }) };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.queryByText("dash.subtitles")).toBeNull();
  });

  it("counts the movies and episodes still missing subtitles", () => {
    hooks.subtitles = {
      data: healthy({ episodes: 12, movies: 3, throttled_providers: 0, items: [] }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.getByText("dash.subtitlesMissing:3/12")).toBeTruthy();
  });

  it("stays quiet when no provider is throttled, which is the healthy case", () => {
    // Bazarr's badge counts *throttled* providers, so zero is good news. This
    // was read as "none configured", so the warning showed permanently on a
    // working setup — and would have gone quiet exactly when one started failing.
    hooks.subtitles = {
      data: healthy({ episodes: 1, movies: 0, throttled_providers: 0, items: [] }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.queryByText(/throttled/i)).toBeNull();
  });

  it("warns when a provider is throttled, since it silently returns nothing", () => {
    hooks.subtitles = {
      data: healthy({ episodes: 1, movies: 0, throttled_providers: 2, items: [] }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.getByText("dash.throttledProviders:2")).toBeTruthy();
  });

  it("lists the missing languages per item", () => {
    hooks.subtitles = {
      data: healthy({
        episodes: 1,
        movies: 0,
        providers: 2,
        items: [
          {
            kind: "episode",
            id: 5,
            series_id: 2,
            title: "Severance S02E01",
            subtitle: "Hello Ms Cobel",
            missing: ["da", "en"],
          },
        ],
      }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.getByText("Severance S02E01")).toBeTruthy();
    expect(screen.getByText(/da, en/)).toBeTruthy();
  });

  it("caps the list at 8 items", () => {
    hooks.subtitles = {
      data: healthy({
        episodes: 20,
        movies: 0,
        providers: 2,
        items: Array.from({ length: 20 }, (_, i) => ({
          kind: "episode",
          id: i,
          title: `Ep ${i}`,
        })),
      }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    expect(screen.getAllByText(/^Ep \d+$/)).toHaveLength(8);
  });

  it("searches for the item it was asked about, carrying the series id along", () => {
    // Bazarr addresses an episode by its own id but needs the series id to
    // reach it, so dropping it makes the search a no-op.
    hooks.subtitles = {
      data: healthy({
        episodes: 1,
        movies: 0,
        providers: 2,
        items: [{ kind: "episode", id: 5, series_id: 2, title: "Severance S02E01" }],
      }),
    };
    render(<SubtitlesSection configured={new Set(["bazarr"])} />);
    fireEvent.click(screen.getByText("dash.searchSubs"));
    expect(subtitleSearch).toHaveBeenCalledWith({ kind: "episode", id: 5, series_id: 2 });
  });
});

describe("trends", () => {
  it("renders nothing until there are two samples to draw a line between", () => {
    hooks.stats = { data: [sample()] };
    render(<TrendsSection />);
    expect(screen.queryByText("dash.trends")).toBeNull();
  });

  it("renders nothing while the history is still loading", () => {
    render(<TrendsSection />);
    expect(screen.queryByText("dash.trends")).toBeNull();
  });

  it("reports the newest sample, not the oldest", () => {
    // The series is oldest-first, so reading data[0] would show last month's
    // library size and never move.
    hooks.stats = {
      data: [
        sample({ movies: 10, series: 4, library_bytes: 1024 ** 4, indexer_grabs: 3 }),
        sample({ movies: 31, series: 9, library_bytes: 2 * 1024 ** 4, indexer_grabs: 44 }),
      ],
    };
    render(<TrendsSection />);
    expect(screen.getByText("2.0 TB")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("44")).toBeTruthy();
  });

  it("draws one sparkline per tile and links to the full stats page", () => {
    hooks.stats = { data: [sample(), sample({ movies: 12 })] };
    const { container } = render(<TrendsSection />);
    expect(container.querySelectorAll("polyline")).toHaveLength(4);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/stats");
  });

  it("plots a flat series without dividing by a zero span", () => {
    // min === max makes the range 0; without the guard every point becomes NaN
    // and the polyline silently vanishes.
    hooks.stats = { data: [sample({ movies: 10 }), sample({ movies: 10 })] };
    const { container } = render(<TrendsSection />);
    const points = container.querySelector("polyline")?.getAttribute("points") ?? "";
    expect(points).not.toMatch(/NaN/);
    expect(points.split(" ")).toHaveLength(2);
  });
});
