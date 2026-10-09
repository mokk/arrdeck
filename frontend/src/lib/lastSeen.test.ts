import { describe, expect, it } from "vitest";
import { finishedSince } from "./lastSeen";

describe("finishedSince", () => {
  const since = "2026-10-09T12:00:00.000Z";
  const at = (iso: string) => Date.parse(iso) / 1000;

  it("marks a torrent that finished after the cutoff", () => {
    expect(finishedSince(at("2026-10-09T12:00:01Z"), since)).toBe(true);
  });

  it("leaves one that finished before it", () => {
    expect(finishedSince(at("2026-10-09T11:59:59Z"), since)).toBe(false);
  });

  it("leaves unfinished torrents, however the client says so", () => {
    expect(finishedSince(null, since)).toBe(false);
    expect(finishedSince(undefined, since)).toBe(false);
    // qBittorrent reports 0 or -1 rather than null on some versions
    expect(finishedSince(0, since)).toBe(false);
    expect(finishedSince(-1, since)).toBe(false);
  });
});
