import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPref, setPref } from "./prefs";
import { usePrefsSync } from "./prefsSync";
import { readPalette, readPreference, setPalette } from "./theme";

const fetchMock = vi.fn();
let server: { values: Record<string, unknown>; updated_at: number };

const json = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
const sentBody = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const settle = () => vi.advanceTimersByTimeAsync(10);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#0f1219" />';
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  server = { values: {}, updated_at: 0 };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body as string);
      if (body.updated_at >= server.updated_at) server = body;
    }
    return json(server);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePrefsSync", () => {
  it("does nothing until the API is reachable", async () => {
    renderHook(() => usePrefsSync(false));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies a newer server copy to storage and to the theme", async () => {
    server = {
      updated_at: 5000,
      values: {
        "layout.movies": "list",
        tabOrder: ["/shows"],
        palette: "nord",
        theme: "light",
      },
    };
    renderHook(() => usePrefsSync(true));
    await settle();
    expect(readPref("layout.movies")).toBe("list");
    expect(readPref("tabOrder")).toEqual(["/shows"]);
    expect(readPalette()).toBe("nord");
    expect(readPreference()).toBe("light");
    expect(document.documentElement.dataset.palette).toBe("nord");
    expect(document.documentElement.dataset.theme).toBe("light");
    // adopting is not a change to send back
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts()).toHaveLength(0);
  });

  it("ignores values this build cannot show", async () => {
    server = { updated_at: 5000, values: { "layout.movies": "hologram", dates: "absolute" } };
    renderHook(() => usePrefsSync(true));
    await settle();
    expect(readPref("layout.movies")).toBe("posters");
    expect(readPref("dates")).toBe("absolute");
  });

  it("leaves language alone", async () => {
    localStorage.setItem("arrdeck.lang", '"da"');
    server = { updated_at: 5000, values: { lang: "en", "arrdeck.lang": "en" } };
    renderHook(() => usePrefsSync(true));
    await settle();
    expect(localStorage.getItem("arrdeck.lang")).toBe('"da"');
  });

  it("sends one request for a burst of changes, a second after the last", async () => {
    renderHook(() => usePrefsSync(true));
    await settle();
    setPref("dates", "absolute");
    await vi.advanceTimersByTimeAsync(600);
    setPref("sizes", "decimal");
    setPalette("dracula");
    await vi.advanceTimersByTimeAsync(900);
    expect(puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(puts()).toHaveLength(1);
    const body = sentBody(puts()[0]);
    expect(body.values).toMatchObject({
      dates: "absolute",
      sizes: "decimal",
      palette: "dracula",
    });
    expect(body.updated_at).toBeGreaterThan(0);
    expect(server.values).toMatchObject({ dates: "absolute", palette: "dracula" });
  });

  it("sends choices made before the first sync to an empty server", async () => {
    localStorage.setItem("prefs.spoilers", '"always"');
    renderHook(() => usePrefsSync(true));
    await settle();
    expect(puts()).toHaveLength(1);
    expect(server.values.spoilers).toBe("always");
  });

  it("does not seed the server with a device's defaults", async () => {
    renderHook(() => usePrefsSync(true));
    await settle();
    expect(puts()).toHaveLength(0);
  });

  it("returns keys it does not know unchanged", async () => {
    server = {
      updated_at: 5000,
      values: { futureThing: ["a", "b"], dates: "relative" },
    };
    renderHook(() => usePrefsSync(true));
    await settle();
    setPref("sizes", "decimal");
    await vi.advanceTimersByTimeAsync(1100);
    expect(sentBody(puts()[0]).values.futureThing).toEqual(["a", "b"]);
  });

  it("keeps a change that could not be sent and retries it with the next run", async () => {
    renderHook(() => usePrefsSync(true));
    await settle();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    setPref("dates", "absolute");
    await vi.advanceTimersByTimeAsync(1100);
    expect(readPref("dates")).toBe("absolute");
    expect(server.updated_at).toBe(0);
    setPref("sizes", "decimal");
    await vi.advanceTimersByTimeAsync(1100);
    expect(server.values).toMatchObject({ dates: "absolute", sizes: "decimal" });
  });

  it("adopts the server's copy when another device's write was later", async () => {
    renderHook(() => usePrefsSync(true));
    await settle();
    setPref("dates", "absolute");
    // another device writes after our change but before our request lands
    server = { updated_at: Date.now() + 500, values: { dates: "relative", confirm: "never" } };
    await vi.advanceTimersByTimeAsync(1100);
    expect(readPref("dates")).toBe("relative");
    expect(readPref("confirm")).toBe("never");
  });

  it("adopts what the server answers when it rejected our write as stale", async () => {
    renderHook(() => usePrefsSync(true));
    await settle();
    const newer = {
      updated_at: Date.now() + 60_000,
      values: { dates: "relative", sizes: "decimal" },
    };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      json(init?.method === "PUT" ? newer : server),
    );
    setPref("dates", "absolute");
    await vi.advanceTimersByTimeAsync(1100);
    expect(puts()).toHaveLength(1);
    expect(readPref("dates")).toBe("relative");
    expect(readPref("sizes")).toBe("decimal");
    // and that is settled: no second push of what was just adopted
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts()).toHaveLength(1);
  });

  it("keeps a change made on a clock that runs behind the server's", async () => {
    server = { updated_at: Date.now() + 120_000, values: { dates: "relative" } };
    renderHook(() => usePrefsSync(true));
    await settle();
    setPref("dates", "absolute");
    await vi.advanceTimersByTimeAsync(1100);
    expect(puts()).toHaveLength(1);
    expect(readPref("dates")).toBe("absolute");
    expect(server.values.dates).toBe("absolute");
  });
});
