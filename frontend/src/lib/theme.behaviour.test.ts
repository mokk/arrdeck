/** The switching logic, which is the part a screenshot would have shown. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPreference, setPreference, watchSystemTheme } from "./theme";

type Listener = () => void;

function stubMatchMedia(prefersLight: boolean) {
  const listeners: Listener[] = [];
  const media = {
    matches: prefersLight,
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    removeEventListener: (_: string, fn: Listener) => {
      const at = listeners.indexOf(fn);
      if (at > -1) listeners.splice(at, 1);
    },
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    media,
    listeners,
    emit(nowPrefersLight: boolean) {
      media.matches = nowPrefersLight;
      for (const fn of [...listeners]) fn();
    },
  };
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#0f1219" />';
});

afterEach(() => vi.unstubAllGlobals());

describe("theme preference", () => {
  it("defaults to system, and stores nothing for it", () => {
    stubMatchMedia(false);
    expect(readPreference()).toBe("system");
    setPreference("system");
    expect(localStorage.getItem("arrdeck.theme")).toBeNull();
  });

  it("ignores a junk stored value rather than breaking the palette", () => {
    localStorage.setItem("arrdeck.theme", "solarized");
    expect(readPreference()).toBe("system");
  });

  it("pins light against a dark OS", () => {
    stubMatchMedia(false);
    setPreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readPreference()).toBe("light");
  });

  it("pins dark against a light OS", () => {
    stubMatchMedia(true);
    setPreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resolves system from the OS in both directions", () => {
    stubMatchMedia(true);
    setPreference("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    stubMatchMedia(false);
    setPreference("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to dark where matchMedia is missing", () => {
    // Not a guess at the user's taste: dark is the palette the app was built
    // against, so it is the safe answer.
    vi.stubGlobal("matchMedia", undefined);
    setPreference("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("moves theme-color with the palette, so browser chrome matches", () => {
    stubMatchMedia(false);
    setPreference("light");
    expect(themeColor()).toBe("#f4f6fa");
    setPreference("dark");
    expect(themeColor()).toBe("#0f1219");
  });
});

describe("following the OS while open", () => {
  it("switches when the system flips and the preference is system", () => {
    const mm = stubMatchMedia(false);
    setPreference("system");
    const stop = watchSystemTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");

    mm.emit(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    stop();
  });

  it("leaves a pinned theme alone when the system flips", () => {
    const mm = stubMatchMedia(false);
    setPreference("dark");
    const stop = watchSystemTheme();
    mm.emit(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    stop();
  });

  it("stops listening once torn down", () => {
    const mm = stubMatchMedia(false);
    setPreference("system");
    watchSystemTheme()();
    expect(mm.listeners).toHaveLength(0);
  });
});

describe("the boot script in index.html", () => {
  // It duplicates the resolution rule on purpose — the module cannot load before
  // first paint — so pin the parts that would silently drift.
  const html = readFileSync("index.html", "utf8");

  it("uses the same storage key as the module", () => {
    expect(html).toContain('localStorage.getItem("arrdeck.theme")');
  });

  it("sets data-theme and the matching theme-color before the app loads", () => {
    expect(html).toContain("document.documentElement.dataset.theme");
    expect(html).toContain("#f4f6fa");
    expect(html.indexOf("arrdeck.theme")).toBeLessThan(html.indexOf("/src/main.tsx"));
  });
});
