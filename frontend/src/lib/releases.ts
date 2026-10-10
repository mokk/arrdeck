// Sorting and filtering for the interactive-search sheet. Kept apart from the
// component so the ordering rules can be tested without rendering a drawer.
import type { ArrRelease } from "../api/types";

/** "best" is the server's order: approved first, then most seeders. */
export type ReleaseSort = "best" | "score" | "size" | "seeders" | "age";
export const RELEASE_SORTS: ReleaseSort[] = ["best", "score", "size", "seeders", "age"];

export type ReleaseFilters = {
  text: string;
  quality: string; // "" = any
  group: string; // "" = any
  approvedOnly: boolean;
  minBytes: number | null;
  maxBytes: number | null;
};

export const NO_FILTERS: ReleaseFilters = {
  text: "",
  quality: "",
  group: "",
  approvedOnly: false,
  minBytes: null,
  maxBytes: null,
};

export function filtersActive(f: ReleaseFilters): boolean {
  return (Object.keys(NO_FILTERS) as (keyof ReleaseFilters)[]).some(
    (k) => f[k] !== NO_FILTERS[k],
  );
}

export function filterReleases(rows: ArrRelease[], f: ReleaseFilters): ArrRelease[] {
  // every word must appear, so "2160p remux" finds the title in either order
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.approvedOnly && r.approved === false) return false;
    if (f.quality && r.quality !== f.quality) return false;
    if (f.group && r.release_group !== f.group) return false;
    if (f.minBytes != null && (r.size ?? 0) < f.minBytes) return false;
    if (f.maxBytes != null && (r.size ?? 0) > f.maxBytes) return false;
    const title = r.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

const desc = (n: number | null | undefined, missing = -Infinity) => -(n ?? missing);

/** Rejected releases always sink below approved ones, whatever the sort: they
 * are still listed (the arr's rejection is advice, and grabbing one is
 * allowed) but should not crowd out what it would accept. */
export function sortReleases(rows: ArrRelease[], sort: ReleaseSort): ArrRelease[] {
  const key = (r: ArrRelease): number[] => {
    switch (sort) {
      case "score":
        return [desc(r.custom_format_score, 0), desc(r.seeders)];
      case "size":
        return [desc(r.size)];
      case "seeders":
        return [desc(r.seeders)];
      case "age":
        return [r.age_days ?? Infinity]; // newest first
      default:
        return [];
    }
  };
  return rows
    .map((r, i) => ({ r, i, k: [r.approved === false ? 1 : 0, ...key(r)] }))
    .sort((a, b) => {
      for (let n = 0; n < a.k.length; n++) {
        if (a.k[n] !== b.k[n]) return a.k[n] < b.k[n] ? -1 : 1;
      }
      return a.i - b.i; // stable, so "best" keeps the server's order
    })
    .map((x) => x.r);
}

/** The values a filter dropdown offers: what the results actually contain. */
export function distinctValues(
  rows: ArrRelease[],
  pick: (r: ArrRelease) => string | null | undefined,
) {
  return [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}
