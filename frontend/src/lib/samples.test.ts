import { describe, expect, it } from "vitest";
import type { StatsSample } from "../api/types";
import { knownPoints, torrentCount } from "./samples";

const s = (ts: number, extra: Partial<StatsSample>): StatsSample => ({ ts, ...extra });

describe("stats samples", () => {
  it("skips samples where the value is unknown, keeping real zeros", () => {
    const samples = [
      s(1, { library_bytes: 100 }),
      s(2, { library_bytes: null }),
      s(3, {}),
      s(4, { library_bytes: 0 }),
    ];
    expect(
      knownPoints(samples, (x) => x.library_bytes).map((p) => [p.sample.ts, p.value]),
    ).toEqual([
      [1, 100],
      [4, 0],
    ]);
  });

  it("counts torrents across clients, unknown only when neither answered", () => {
    expect(torrentCount(s(1, { torrents_qbit: 3, torrents_tm: null }))).toBe(3);
    expect(torrentCount(s(1, { torrents_qbit: null, torrents_tm: null }))).toBeNull();
  });
});
