import {
} from "@/components/ui/select";
import { usePersistentState } from "../hooks/usePersistentState";

/** Persisted sort state + a generic row sorter (nulls always last). */
export function useSort<T extends Record<string, unknown>>(
  persistKey: string,
  defaultKey: string,
  defaultDir: "asc" | "desc" = "asc",
) {
  const [sortKey, setSortKey] = usePersistentState<string>(`${persistKey}.key`, defaultKey);
  const [sortDir, setSortDir] = usePersistentState<"asc" | "desc">(
    `${persistKey}.dir`,
    defaultDir,
  );

  const sortRows = (rows: T[]): T[] =>
    [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let base: number;
      if (typeof va === "string" && typeof vb === "string") {
        base = va.localeCompare(vb, undefined, { sensitivity: "base" });
      } else if (typeof va === "boolean" && typeof vb === "boolean") {
        base = Number(va) - Number(vb);
      } else {
        base = (va as number) - (vb as number);
      }
      return sortDir === "desc" ? -base : base;
    });

  return { sortKey, setSortKey, sortDir, setSortDir, sortRows };
}

