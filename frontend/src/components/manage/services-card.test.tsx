/** Settings → System lists every service with how long it has been down, and a
 * Restart (or Start) button for whatever the host helper can restart —
 * including arrdeck itself, which is not a service but is worth a warning. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join("/")}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const state = vi.hoisted(() => ({
  status: { data: undefined as unknown },
  restartable: { data: undefined as unknown },
  action: { mutate: vi.fn(), isPending: false },
}));

vi.mock("../../hooks/queries", () => ({
  useQualityProfiles: () => ({ data: undefined }),
  useTasks: () => ({ data: undefined }),
  useArrBackups: () => ({ data: undefined }),
  useServices: () => ({ data: [] }),
  useLogs: () => ({ data: [], isFetching: false }),
  useStatus: () => state.status,
  useRestartable: () => state.restartable,
  useServiceAction: () => state.action,
}));

import { SystemTab } from "./System";

const project = (over: Record<string, unknown> = {}) => ({
  name: "radarr",
  service: "radarr",
  running: true,
  containers: 1,
  running_containers: 1,
  error: null,
  is_self: false,
  ...over,
});

beforeEach(() => {
  state.status.data = undefined;
  state.restartable.data = undefined;
  state.action.mutate.mockClear();
});

describe("the services card", () => {
  it("says since when a service has been down", () => {
    state.status.data = [
      { service: "radarr", ok: false, error: "refused", down_since: "2026-10-10T12:00:00Z" },
    ];
    state.restartable.data = { configured: false, projects: [] };
    render(<SystemTab />);
    expect(screen.getByText(/^system\.downSince:/)).toBeTruthy();
    expect(screen.getByText("system.helperMissing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /system\.restart/ })).toBeNull();
  });

  it("starts a stopped project rather than restarting it", async () => {
    state.status.data = [{ service: "radarr", ok: false, error: "refused" }];
    state.restartable.data = {
      configured: true,
      projects: [project({ running: false, running_containers: 0 })],
    };
    render(<SystemTab />);
    fireEvent.click(screen.getByRole("button", { name: "system.start" }));
    await waitFor(() => expect(state.action.mutate).toHaveBeenCalledTimes(1));
    expect(state.action.mutate.mock.calls[0][0]).toEqual({ name: "radarr", action: "up" });
  });

  it("lists arrdeck itself from the helper, with its own row", () => {
    state.status.data = [{ service: "radarr", ok: true, version: "6.2.1" }];
    state.restartable.data = {
      configured: true,
      projects: [project(), project({ name: "arrdeck", service: null, is_self: true })],
    };
    render(<SystemTab />);
    expect(screen.getByText("arrdeck")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "system.restart" })).toHaveLength(2);
  });

  it("shows why the helper cannot be reached", () => {
    state.restartable.data = { configured: true, error: "connection refused", projects: [] };
    render(<SystemTab />);
    expect(screen.getByText("system.helperUnreachable:connection refused")).toBeTruthy();
  });
});
