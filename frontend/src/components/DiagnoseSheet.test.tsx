/** The sheet turns finding codes into sentences. A wrong or empty sentence here
 * is worse than none: it sends someone to fix an indexer when the film simply is
 * not out yet. */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "diagnose.unknown_code") return String(vars?.defaultValue ?? key);
      const params = vars
        ? Object.entries(vars)
            .filter(([k]) => k !== "defaultValue")
            .map(([k, v]) => `${k}=${v}`)
            .join(",")
        : "";
      return params ? `${key}(${params})` : key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const state = vi.hoisted(() => ({
  result: { data: undefined as unknown, error: undefined as unknown, isLoading: false },
}));
vi.mock("../hooks/queries", () => ({ useDiagnose: () => state.result }));

import { DiagnoseSheet } from "./DiagnoseSheet";

function open(findings: unknown[]) {
  state.result = {
    data: { app: "radarr", id: 7, title: "Dune", findings },
    error: undefined,
    isLoading: false,
  };
  return render(<DiagnoseSheet app="radarr" id={7} title="Dune" onClose={() => {}} />);
}

beforeEach(() => {
  state.result = { data: undefined, error: undefined, isLoading: false };
});

describe("diagnosis sheet", () => {
  it("renders a finding as a sentence with its values", () => {
    open([{ code: "queue_failed", level: "blocked", params: { reason: "no space left" } }]);
    expect(screen.getByText(/diagnose\.queue_failed\(reason=no space left\)/)).toBeTruthy();
  });

  it("uses the dated wording only when a date is known", () => {
    // An announced film often has no release date yet, and the undated sentence
    // would otherwise read "expected undefined".
    open([
      {
        code: "not_yet_available",
        level: "blocked",
        params: { availability: "released", date: "2027-01-05" },
      },
    ]);
    expect(screen.getByText(/not_yet_available_dated/)).toBeTruthy();
  });

  it("uses the undated wording when the date is null", () => {
    open([
      {
        code: "not_yet_available",
        level: "blocked",
        params: { availability: "released", date: null },
      },
    ]);
    expect(screen.getByText(/diagnose\.not_yet_available\(/)).toBeTruthy();
    expect(screen.queryByText(/not_yet_available_dated/)).toBeNull();
  });

  it("colours the dot by level, which is the only severity cue", () => {
    // The sheet renders through a portal, so the queries go against the document
    // rather than the render container.
    open([
      { code: "queue_failed", level: "blocked", params: {} },
      { code: "rss_stale", level: "info", params: {} },
    ]);
    const dots = [...document.body.querySelectorAll("span.rounded-full")];
    expect(dots.some((d) => d.className.includes("bg-destructive"))).toBe(true);
    expect(dots.some((d) => d.className.includes("bg-primary"))).toBe(true);
  });

  it("keeps the order the endpoint sorted them into", () => {
    // The endpoint sorts worst-first; re-sorting here would bury the blocker.
    open([
      { code: "queue_failed", level: "blocked", params: {} },
      { code: "rss_stale", level: "info", params: {} },
    ]);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("queue_failed")).toBeGreaterThan(-1);
    expect(text.indexOf("queue_failed")).toBeLessThan(text.indexOf("rss_stale"));
  });

  it("falls back to the code for a finding the frontend does not know", () => {
    // A backend that adds a check should not render a blank row in an app that
    // has not shipped the string yet.
    open([{ code: "unknown_code", level: "info", params: {} }]);
    expect(screen.getByText("unknown_code")).toBeTruthy();
  });

  it("shows a skeleton while the checks run", () => {
    state.result = { data: undefined, error: undefined, isLoading: true };
    render(<DiagnoseSheet app="radarr" id={7} title="Dune" onClose={() => {}} />);
    expect(document.body.querySelector('[data-slot="skeleton"], .animate-pulse')).toBeTruthy();
  });

  it("surfaces a failure instead of an empty sheet", () => {
    state.result = {
      data: undefined,
      error: new Error("radarr unreachable"),
      isLoading: false,
    };
    render(<DiagnoseSheet app="radarr" id={7} title="Dune" onClose={() => {}} />);
    expect(screen.getByText("radarr unreachable")).toBeTruthy();
  });

  it("says something when the backend returned no findings at all", () => {
    open([]);
    expect(screen.getByText("diagnose.nothing_found")).toBeTruthy();
  });
});
