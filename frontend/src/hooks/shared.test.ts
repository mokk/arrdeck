import { describe, expect, it } from "vitest";
import type { PlaySession, QueueItem, ServiceBlock } from "../api/types";
import { queueMoving, sessionsMoving, summaryMoving, torrentsMoving } from "./shared";

// The predicates read a few fields off large generated shapes; spelling out full
// fixtures would bury the case each test is actually making.
// biome-ignore lint/suspicious/noExplicitAny: partial fixtures on purpose
const block = (data: any): any => ({ ok: true, data });

describe("torrentsMoving", () => {
  it("is true while something is downloading", () => {
    expect(
      torrentsMoving({
        qbittorrent: block({ totals: { dl_speed: 0, ul_speed: 0 }, states: ["downloading"] }),
        transmission: block({ totals: { dl_speed: 0, ul_speed: 0 }, states: [] }),
      }),
    ).toBe(true);
  });

  it("is true on download throughput even if no state says so", () => {
    expect(
      torrentsMoving({
        qbittorrent: block({ totals: { dl_speed: 4_000_000 }, states: ["seeding"] }),
        transmission: block(null),
      }),
    ).toBe(true);
  });

  it("is false for a stack that is only seeding", () => {
    // The steady state here: hundreds of torrents seeding, upload ticking over.
    // Polling that every 5s is the cost this backoff exists to remove.
    expect(
      torrentsMoving({
        qbittorrent: block({
          totals: { dl_speed: 0, ul_speed: 101_821 },
          states: ["completed", "seeding"],
        }),
        transmission: block({ totals: { dl_speed: 0, ul_speed: 0 }, states: ["paused"] }),
      }),
    ).toBe(false);
  });

  it("treats a stalled download as not moving", () => {
    expect(
      torrentsMoving({
        qbittorrent: block({ totals: { dl_speed: 0 }, states: ["stalled"] }),
        transmission: block(null),
      }),
    ).toBe(false);
  });

  it("is false before any data arrives, and survives an offline block", () => {
    expect(torrentsMoving(undefined)).toBe(false);
    expect(torrentsMoving({ qbittorrent: block(null), transmission: block(null) })).toBe(false);
  });
});

describe("summaryMoving", () => {
  it("reads the state of the active torrents it ships", () => {
    expect(
      summaryMoving({
        qbittorrent: block({ totals: { dl_speed: 0 }, active: [{ state: "checking" }] }),
      }),
    ).toBe(true);
    expect(
      summaryMoving({
        qbittorrent: block({ totals: { dl_speed: 0 }, active: [{ state: "seeding" }] }),
      }),
    ).toBe(false);
  });

  it("is false with nothing active", () => {
    expect(summaryMoving({ qbittorrent: block({ totals: { dl_speed: 0 }, active: [] }) })).toBe(
      false,
    );
    expect(summaryMoving(undefined)).toBe(false);
  });
});

describe("queueMoving", () => {
  const item = (size_left: number): QueueItem => ({ size_left }) as QueueItem;

  it("is true while an item still has bytes to fetch", () => {
    expect(
      queueMoving({ radarr: block([item(500)]), sonarr: block([]) } as Record<
        string,
        ServiceBlock<QueueItem[]>
      >),
    ).toBe(true);
  });

  it("is false for an empty queue or one that is fully grabbed", () => {
    expect(queueMoving({ radarr: block([]), sonarr: block([]) })).toBe(false);
    expect(queueMoving({ radarr: block([item(0)]) })).toBe(false);
    expect(queueMoving(undefined)).toBe(false);
  });
});

describe("sessionsMoving", () => {
  const session = (state: string): PlaySession => ({ state }) as PlaySession;

  it("follows playback rather than mere presence", () => {
    expect(sessionsMoving(block([session("playing")]))).toBe(true);
    expect(sessionsMoving(block([session("paused")]))).toBe(false);
  });

  it("is false with no sessions", () => {
    expect(sessionsMoving(block([]))).toBe(false);
    expect(sessionsMoving(undefined)).toBe(false);
  });
});
