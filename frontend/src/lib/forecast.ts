// When the disk fills at the pace of the samples: a least-squares line through
// free space over time. Needs a week of history to say anything; a flat or
// growing free space has no date.
import type { StatsSample } from "../api/types";

const DAY = 86_400;
const MIN_SPAN_DAYS = 7;
const MIN_SAMPLES = 10;

type Forecast =
  | { kind: "unknown" }
  | { kind: "steady" }
  | { kind: "full"; days: number; perDay: number };

export function forecastFull(samples: StatsSample[]): Forecast {
  const points = samples
    .filter((s) => s.disk_free_bytes && s.disk_free_bytes > 0)
    .map((s) => ({ x: s.ts / DAY, y: s.disk_free_bytes ?? 0 }));
  if (points.length < MIN_SAMPLES) return { kind: "unknown" };
  const span = points[points.length - 1].x - points[0].x;
  if (span < MIN_SPAN_DAYS) return { kind: "unknown" };
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const slope = sxx ? sxy / sxx : 0; // bytes per day
  if (slope >= 0) return { kind: "steady" };
  const free = points[n - 1].y;
  return { kind: "full", days: free / -slope, perDay: -slope };
}
