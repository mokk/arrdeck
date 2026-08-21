/** An unknown path used to render an empty page with no way back — reachable
 * from a stale notification deep-link or a mistyped bookmark, and the worst
 * failure mode in the app because it looks like a crash. */
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { NotFound } from "./components/NotFound";

/** The real catch-all, in the same Routes shape App uses. Rendering App itself
 * would drag in every page, provider and query client. */
function Harness({ path }: { path: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>dashboard</div>} />
        <Route path="/movie/:id" element={<div>movie</div>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("unknown routes", () => {
  it("known paths still resolve", () => {
    render(<Harness path="/movie/42" />);
    expect(screen.getByText("movie")).toBeTruthy();
  });

  it("an unknown path says so instead of rendering nothing", () => {
    render(<Harness path="/nonsense" />);
    expect(screen.getByText("common.notFound")).toBeTruthy();
  });

  it("shows which path failed, so a bad deep-link is diagnosable", () => {
    render(<Harness path="/nonsense" />);
    expect(screen.getByText("/nonsense")).toBeTruthy();
  });

  it("a deep unknown path also matches", () => {
    render(<Harness path="/movie/42/extra/segments" />);
    expect(screen.getByText("common.notFound")).toBeTruthy();
  });

  it("offers a way back to the dashboard", () => {
    const { container } = render(<Harness path="/nonsense" />);
    const home = container.querySelector('a[href="/"]');
    expect(home).toBeTruthy();
    expect(home?.textContent).toBe("common.backToDashboard");
  });
});

describe("App's route table", () => {
  const source = readFileSync("src/App.tsx", "utf8");

  it("declares the catch-all", () => {
    expect(source).toContain('path="*"');
  });

  it("puts it last, where it cannot shadow a real route", () => {
    expect(source.indexOf('path="*"')).toBeGreaterThan(source.lastIndexOf('path="/stats"'));
  });
});
