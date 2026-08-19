import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ die }: { die: boolean }): React.ReactElement {
  if (die) throw new Error("kaboom");
  return <div>alive</div>;
}

// react logs the caught error itself; keep the test output readable
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => (spy = vi.spyOn(console, "error").mockImplementation(() => {})));
afterEach(() => spy.mockRestore());

describe("ErrorBoundary", () => {
  it("passes children through when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom die={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("alive")).toBeTruthy();
  });

  it("shows the error instead of unmounting the tree", () => {
    render(
      <ErrorBoundary>
        <Boom die />
      </ErrorBoundary>,
    );
    expect(screen.getByText("kaboom")).toBeTruthy();
  });

  it("isolates siblings, which is the point on the dashboard", () => {
    render(
      <div>
        <ErrorBoundary>
          <Boom die />
        </ErrorBoundary>
        <ErrorBoundary>
          <Boom die={false} />
        </ErrorBoundary>
      </div>,
    );
    // one card failed, the other still rendered
    expect(screen.getByText("kaboom")).toBeTruthy();
    expect(screen.getByText("alive")).toBeTruthy();
  });

  it("uses a custom fallback when given one", () => {
    render(
      <ErrorBoundary fallback={(error) => <span>caught: {error.message}</span>}>
        <Boom die />
      </ErrorBoundary>,
    );
    expect(screen.getByText("caught: kaboom")).toBeTruthy();
  });
});
