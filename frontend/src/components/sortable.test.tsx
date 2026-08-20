import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePersistentState } from "../hooks/usePersistentState";
import { useSort } from "./sortable";

beforeEach(() => localStorage.clear());

type Row = Record<string, unknown>;

const rows: Row[] = [
  { name: "beta", size: 30, done: true },
  { name: "Alpha", size: 10, done: false },
  { name: "gamma", size: null, done: true },
];

describe("useSort", () => {
  it("sorts strings case-insensitively", () => {
    const { result } = renderHook(() => useSort<Row>("t1", "name"));
    expect(result.current.sortRows(rows).map((r) => r.name)).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
  });

  it("keeps nulls last regardless of direction", () => {
    const { result } = renderHook(() => useSort<Row>("t2", "size"));
    expect(result.current.sortRows(rows).map((r) => r.size)).toEqual([10, 30, null]);
    act(() => result.current.setSortDir("desc"));
    // a null is "unknown", not "smallest" — it shouldn't lead the descending list
    expect(result.current.sortRows(rows).map((r) => r.size)).toEqual([30, 10, null]);
  });

  it("sorts booleans false-first", () => {
    const { result } = renderHook(() => useSort<Row>("t3", "done"));
    expect(result.current.sortRows(rows).map((r) => r.done)).toEqual([false, true, true]);
  });

  it("does not mutate the array it was given", () => {
    const { result } = renderHook(() => useSort<Row>("t4", "name"));
    const original = [...rows];
    result.current.sortRows(rows);
    expect(rows).toEqual(original);
  });

  it("remembers the key and direction across remounts", () => {
    const first = renderHook(() => useSort<Row>("downloads.sort", "added_on", "desc"));
    act(() => first.result.current.setSortKey("size"));
    first.unmount();
    const second = renderHook(() => useSort<Row>("downloads.sort", "added_on", "desc"));
    expect(second.result.current.sortKey).toBe("size");
    expect(second.result.current.sortDir).toBe("desc");
  });
});

describe("usePersistentState", () => {
  it("restores a stored value instead of the initial one", () => {
    localStorage.setItem("k", JSON.stringify("stored"));
    const { result } = renderHook(() => usePersistentState("k", "initial"));
    expect(result.current[0]).toBe("stored");
  });

  it("falls back to the initial value when the stored json is corrupt", () => {
    localStorage.setItem("k", "{not json");
    const { result } = renderHook(() => usePersistentState("k", "initial"));
    expect(result.current[0]).toBe("initial");
  });

  it("round-trips objects, not just strings", () => {
    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>("clients", { qbittorrent: true }),
    );
    act(() => result.current[1]({ qbittorrent: false, transmission: true }));
    expect(JSON.parse(localStorage.getItem("clients")!)).toEqual({
      qbittorrent: false,
      transmission: true,
    });
  });
});
