import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PREF_KEYS, setPref, storePrefs, usePref } from "../../lib/prefs";
import { Cover } from "./Cover";
import { letterOf } from "./LetterScrubber";
import { albumState, formatDuration, musicLinks } from "./music";
import { UpNextView } from "./UpNext";

describe("letterOf", () => {
  it("takes the first letter, upper-cased", () => {
    expect(letterOf("dune")).toBe("D");
    expect(letterOf("  Ørnen")).toBe("Ø");
  });

  it("files digits, punctuation and blanks under #", () => {
    expect(letterOf("2001: A Space Odyssey")).toBe("#");
    expect(letterOf("(500) Days")).toBe("#");
    expect(letterOf(null)).toBe("#");
  });
});

describe("Cover", () => {
  it("shows the title when there is no artwork", () => {
    const { getByText } = render(<Cover title="Count Zero" subtitle="William Gibson" />);
    expect(getByText("Count Zero")).toBeTruthy();
    expect(getByText("William Gibson")).toBeTruthy();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    const { container, getByText } = render(<Cover src="/broken.jpg" title="Neuromancer" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("Neuromancer")).toBeTruthy();
  });
});

describe("prefs", () => {
  it("defaults, then follows setPref in every reader", () => {
    localStorage.removeItem("prefs.layout.movies");
    const { result } = renderHook(() => usePref("layout.movies"));
    expect(result.current).toBe("posters");
    act(() => setPref("layout.movies", "details"));
    expect(result.current).toBe("details");
    expect(localStorage.getItem("prefs.layout.movies")).toBe('"details"');
  });

  it("syncs exactly these keys", () => {
    // the wire keys of GET/PUT /prefs; the music pair came with the Music tab
    expect([...PREF_KEYS].sort()).toEqual(
      [
        "startTab",
        "tabOrder",
        "hiddenTabs",
        "dates",
        "sizes",
        "spoilers",
        "confirm",
        "layout.movies",
        "layout.series",
        "layout.books",
        "layout.music",
        "unmonitored.movies",
        "unmonitored.series",
        "unmonitored.books",
        "unmonitored.music",
      ].sort(),
    );
  });

  it("takes a music layout from the server, but not one only shows have", () => {
    localStorage.removeItem("prefs.layout.music");
    storePrefs({ "layout.music": "upnext" });
    const { result } = renderHook(() => usePref("layout.music"));
    expect(result.current).toBe("posters");
    act(() => storePrefs({ "layout.music": "details", "unmonitored.music": "hide" }));
    expect(result.current).toBe("details");
    expect(localStorage.getItem("prefs.unmonitored.music")).toBe('"hide"');
  });
});

describe("music", () => {
  it("links MusicBrainz first, then the known sites, six at most", () => {
    const links = musicLinks("artist", "abc", [
      { name: "myspace", url: "https://myspace.com/x" },
      { name: "discogs", url: "https://www.discogs.com/artist/307" },
      { name: "last", url: "https://www.last.fm/music/x" },
    ]);
    expect(links.map((l) => l.label)).toEqual(["MusicBrainz", "Discogs", "Last.fm"]);
    expect(links[0].url).toBe("https://musicbrainz.org/artist/abc");
  });

  it("calls an album downloaded only when every track is there", () => {
    expect(albumState({ monitored: true, track_count: 18, track_file_count: 18 })).toBe(
      "downloaded",
    );
    expect(albumState({ monitored: true, track_count: 24, track_file_count: 3 })).toBe(
      "wanted",
    );
    expect(albumState({ monitored: false, track_count: 24, track_file_count: 0 })).toBe(
      "unmonitored",
    );
  });

  it("writes durations the way a player does", () => {
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(321)).toBe("5:21");
    expect(formatDuration(4092)).toBe("1:08:12");
    expect(formatDuration(null)).toBe("");
  });
});

describe("UpNextView", () => {
  it("lists airing shows soonest first and folds the rest away", () => {
    const ep = (air_date: string) => ({ season: 1, episode: 1, air_date });
    const { container } = render(
      <UpNextView
        onOpen={() => {}}
        rows={[
          { id: 1, title: "Zeta" },
          { id: 2, title: "Later", next_episode: ep("2026-10-20T00:00:00Z") },
          { id: 3, title: "Alpha" },
          { id: 4, title: "Sooner", next_episode: ep("2026-09-25T00:00:00Z") },
        ]}
      />,
    );
    const titles = [
      ...container.querySelectorAll(".font-medium.truncate, .truncate.font-medium"),
    ].map((el) => el.textContent);
    expect(titles).toEqual(["Sooner", "Later"]);
  });
});

describe("series monitor choice", () => {
  it("sends a preset as is, and picked seasons sorted", async () => {
    const { monitorPayload } = await import("./SeriesMonitor");
    expect(monitorPayload("lastSeason", null, undefined)).toEqual({ monitor: "lastSeason" });
    expect(monitorPayload("pick", new Set([3, 1]), [0, 1, 2, 3])).toEqual({ seasons: [1, 3] });
  });

  it("picks every regular season until one is untoggled", async () => {
    const { monitorPayload } = await import("./SeriesMonitor");
    expect(monitorPayload("pick", null, [0, 1, 2])).toEqual({ seasons: [1, 2] });
  });
});
