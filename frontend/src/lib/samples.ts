// Stats samples where a value is known. A sample taken while a service was
// down has that value as null — a gap, not a zero, so charts skip it rather
// than drawing a cliff to nothing.
import type { StatsSample } from "../api/types";

export type Pick = (s: StatsSample) => number | null | undefined;

/** The samples that have a value for `pick`, with that value. */
export function knownPoints(
  samples: StatsSample[],
  pick: Pick,
): { sample: StatsSample; value: number }[] {
  return samples.flatMap((sample) => {
    const value = pick(sample);
    return value == null ? [] : [{ sample, value }];
  });
}

/** Torrents across both clients; unknown only when neither answered. */
export function torrentCount(s: StatsSample): number | null {
  if (s.torrents_qbit == null && s.torrents_tm == null) return null;
  return (s.torrents_qbit ?? 0) + (s.torrents_tm ?? 0);
}
