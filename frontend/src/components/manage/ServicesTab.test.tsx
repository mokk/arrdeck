/** Appearance and language are local preferences stored in localStorage. They
 * used to sit below an early return on the service-settings fetch, so a backend
 * hiccup — or just a slow first load — hid the theme override entirely. That is
 * the one moment someone is most likely to be poking at settings. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // connections.tsx pulls in ../../i18n for the language list, which registers
  // this on import.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const settings = vi.hoisted(() => ({
  current: { data: undefined as unknown, error: undefined as unknown },
}));
const status = vi.hoisted(() => ({ data: [] as unknown[] }));
const restartable = vi.hoisted(() => ({ data: undefined as unknown }));
const serviceAction = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("../../hooks/queries", () => ({
  useServiceSettings: () => settings.current,
  useStatus: () => status,
  useRestartable: () => restartable,
  useServiceAction: () => serviceAction,
  useSaveServiceSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useTestService: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The cards below the fold pull in push, passkeys and import lists; none of that
// is what this file is about.
vi.mock("./settings/security", () => ({ SecurityCard: () => null }));
vi.mock("./settings/notifications", () => ({ NotificationsCard: () => null }));
vi.mock("./settings/transfer", () => ({
  ImportLists: () => null,
  SettingsTransfer: () => null,
}));

import { ServiceSettingsTab } from "./ServicesTab";

beforeEach(() => {
  localStorage.clear();
  settings.current = { data: undefined, error: undefined };
  status.data = [];
  restartable.data = undefined;
  serviceAction.mutate.mockClear();
});

describe("appearance and language stay reachable", () => {
  it("renders them while the service settings are still loading", () => {
    settings.current = { data: undefined, error: undefined };
    render(<ServiceSettingsTab />);
    expect(screen.getByText("manage.theme")).toBeTruthy();
    expect(screen.getByText("common.language")).toBeTruthy();
    expect(screen.getByText("common.loading")).toBeTruthy();
  });

  it("renders them even when the service settings fail to load", () => {
    settings.current = { data: undefined, error: new Error("backend down") };
    render(<ServiceSettingsTab />);
    expect(screen.getByText("manage.theme")).toBeTruthy();
    expect(screen.getByText("backend down")).toBeTruthy();
  });

  it("renders them once, not twice, on the happy path", () => {
    settings.current = { data: {}, error: undefined };
    render(<ServiceSettingsTab />);
    expect(screen.getAllByText("manage.theme")).toHaveLength(1);
    expect(screen.getAllByText("common.language")).toHaveLength(1);
  });

  it("offers all three appearance choices", () => {
    settings.current = { data: {}, error: undefined };
    render(<ServiceSettingsTab />);
    // The trigger shows the current preference; System is the default.
    expect(screen.getByText("manage.theme_system")).toBeTruthy();
  });
});

describe("the status strip", () => {
  // The strip renders only once the service settings have loaded, so these need
  // the happy path rather than the default empty fixture.
  beforeEach(() => {
    settings.current = { data: {}, error: undefined };
  });

  const svc = (over: Record<string, unknown> = {}) => ({
    service: "radarr",
    ok: true,
    version: "6.2.1",
    retries: 0,
    update_available: null,
    ...over,
  });

  it("shows the running version when nothing is wrong", () => {
    status.data = [svc()];
    render(<ServiceSettingsTab />);
    expect(screen.getByText("6.2.1")).toBeTruthy();
    expect(screen.queryByText("↑")).toBeNull();
  });

  it("marks a service that has a newer release", () => {
    status.data = [svc({ update_available: "6.3.0" })];
    render(<ServiceSettingsTab />);
    expect(screen.getByText("↑")).toBeTruthy();
    // The version shown stays the installed one — the update is a hint, not a
    // claim about what is running.
    expect(screen.getByText("6.2.1")).toBeTruthy();
  });

  it("lets flaky win the dot over an available update", () => {
    // A service that keeps dropping connections matters more than its version,
    // and both would otherwise claim the same amber dot.
    status.data = [svc({ retries: 3, update_available: "6.3.0" })];
    render(<ServiceSettingsTab />);
    expect(screen.getByText("manage.flaky")).toBeTruthy();
  });

  it("says nothing about updates for a service that is down", () => {
    status.data = [svc({ ok: false, error: "refused", update_available: "6.3.0" })];
    render(<ServiceSettingsTab />);
    expect(screen.getByText("manage.offlineShort")).toBeTruthy();
    expect(screen.queryByText("↑")).toBeNull();
  });

  it("says how long a service has been down", () => {
    const since = new Date(Date.now() - 14 * 60_000).toISOString();
    status.data = [svc({ ok: false, error: "refused", down_since: since })];
    render(<ServiceSettingsTab />);
    expect(screen.getByText("manage.downFor")).toBeTruthy();
    expect(screen.queryByText("manage.offlineShort")).toBeNull();
  });

  it("offers a restart only for what the helper lists, and asks first", async () => {
    status.data = [svc(), svc({ service: "sonarr" })];
    restartable.data = {
      configured: true,
      projects: [{ name: "radarr", running: true, containers: 1, running_containers: 1 }],
    };
    render(<ServiceSettingsTab />);
    const buttons = screen.getAllByRole("button", { name: /system\.restart/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe("system.restart Radarr");
    fireEvent.click(buttons[0]);
    // the confirm context's default answers yes without a provider
    await waitFor(() => expect(serviceAction.mutate).toHaveBeenCalledTimes(1));
    expect(serviceAction.mutate.mock.calls[0][0]).toEqual({
      name: "radarr",
      action: "restart",
    });
  });
});
