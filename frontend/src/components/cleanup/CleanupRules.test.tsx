/** Switching automatic cleanup or a rule on is the step that can end in
 * deleted files, so it must not reach the server without a yes. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: { action?: string }) => o?.action ?? key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { setPref } from "../../lib/prefs";
import { ConfirmProvider } from "../Confirm";
import { CleanupRules } from "./CleanupRules";

const RULES = {
  settings: { enabled: false, max_deletions: 10 },
  rules: [
    {
      id: "r1",
      name: "Old films",
      kind: "movie",
      enabled: false,
      grace_days: 14,
      conditions: { watched_days: 180 },
    },
  ],
};

let puts: unknown[] = [];

beforeEach(() => {
  puts = [];
  setPref("confirm", "deletes");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return new Response(JSON.stringify(body), { status: 200 });
      }
      const data = url.endsWith("/cleanup/rules") ? RULES : [];
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("prefs.confirm");
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfirmProvider>
        <CleanupRules />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("cleanup rules", () => {
  it("asks before the master switch goes on, and a no changes nothing", async () => {
    show();
    const toggle = await screen.findByRole("switch", { name: "cleanupRules.switchTitle" });
    fireEvent.click(toggle);
    await screen.findByText("cleanupRules.turnOnBody");
    fireEvent.click(screen.getByText("common.cancel"));
    await act(async () => {});
    expect(puts).toEqual([]);

    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole("button", { name: "cleanupRules.turnOn" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ settings: { enabled: true }, rules: RULES.rules });
  });

  it("asks before a rule goes on", async () => {
    show();
    fireEvent.click(await screen.findByRole("switch", { name: "cleanupRules.toggleRule" }));
    fireEvent.click(await screen.findByRole("button", { name: "cleanupRules.enableRule" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ rules: [{ id: "r1", enabled: true }] });
  });
});
