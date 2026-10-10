/** Needs attention sits above the downloads: it must vanish when nothing is
 * stuck, say how many things are, quote the arr's own reasons, and open the
 * import sheet for the right item. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars && "defaultValue" in vars) return String(vars.defaultValue);
      return vars ? `${key}:${Object.values(vars).join("/")}` : key;
    },
  }),
}));

const hooks = vi.hoisted(() => ({ queue: { data: undefined as unknown } }));
vi.mock("../../hooks/queries", () => ({ useQueue: () => hooks.queue }));
vi.mock("../ImportSheet", () => ({
  ImportSheet: ({ app, itemId }: { app: string; itemId: number }) => (
    <div>{`import-sheet:${app}:${itemId}`}</div>
  ),
}));

import { NeedsAttention } from "./NeedsAttention";

const healthy = <T,>(data: T) => ({ ok: true, data, error: null, stale_age_seconds: null });
const item = (over: Record<string, unknown> = {}) => ({
  app: "radarr",
  id: 1,
  title: "Dune",
  status: "completed",
  tracked_state: "importBlocked",
  tracked_status: "warning",
  size: 1,
  size_left: 0,
  needs_attention: true,
  status_messages: [
    { title: "Dune.mkv", messages: ["Not an upgrade for existing movie file"] },
  ],
  ...over,
});

beforeEach(() => {
  hooks.queue = { data: undefined };
});

describe("needs attention", () => {
  it("renders nothing while nothing is stuck", () => {
    hooks.queue = {
      data: { radarr: healthy([item({ needs_attention: false })]), sonarr: healthy([]) },
    };
    const { container } = render(<NeedsAttention />);
    expect(container.textContent).toBe("");
  });

  it("lists stuck items from every arr with a count and the arr's reasons", () => {
    hooks.queue = {
      data: {
        radarr: healthy([item(), item({ id: 2, needs_attention: false })]),
        sonarr: healthy([
          item({
            app: "sonarr",
            id: 5,
            title: "The Bear",
            status_messages: [],
            error_message: "Download client is unavailable",
          }),
        ]),
      },
    };
    render(<NeedsAttention />);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Not an upgrade for existing movie file")).toBeTruthy();
    expect(screen.getByText("Download client is unavailable")).toBeTruthy();
    expect(screen.queryByText("Release 2")).toBeNull();
  });

  it("opens the import sheet for the item whose Fix was tapped", () => {
    hooks.queue = {
      data: { radarr: healthy([item()]), sonarr: healthy([item({ app: "sonarr", id: 5 })]) },
    };
    render(<NeedsAttention />);
    expect(screen.queryByText(/import-sheet/)).toBeNull();
    fireEvent.click(screen.getAllByText("dl.fix")[1]);
    expect(screen.getByText("import-sheet:sonarr:5")).toBeTruthy();
  });

  it("says which arr could not be asked", () => {
    hooks.queue = {
      data: {
        radarr: healthy([item()]),
        sonarr: { ok: false, data: null, error: "refused", stale_age_seconds: null },
      },
    };
    render(<NeedsAttention />);
    expect(screen.getByText("dl.attentionUnavailable:Sonarr")).toBeTruthy();
  });
});
