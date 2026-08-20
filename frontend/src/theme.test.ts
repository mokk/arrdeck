/** The light palette was derived against WCAG AA, not chosen by eye — the badge
 * colours are read as *text* on --secondary, and the dark theme's blues and
 * greens land near 3:1 on a light background. These tests read the real
 * stylesheet so a future tweak that regresses contrast fails here rather than
 * in daylight on someone's phone. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A repo-relative path, matching module-boundaries.test.ts: vitest runs from the
// package root and import.meta.url is not a file URL under jsdom.
const css = readFileSync("src/index.css", "utf8");

function palette(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} missing from index.css`).toBeGreaterThan(-1);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  expect(h, `expected a 6-digit hex, got ${hex}`).toHaveLength(6);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = palette(':root[data-theme="light"]');
const dark = palette(":root {");

describe("light palette", () => {
  // 4.5:1 is AA for body text. Badges are small text, so they need it too.
  it.each([
    ["foreground on background", "foreground", "background"],
    ["foreground on card", "foreground", "card"],
    ["muted-foreground on card", "muted-foreground", "card"],
    ["muted-foreground on background", "muted-foreground", "background"],
    ["primary badge text", "primary", "secondary"],
    ["destructive badge text", "destructive", "secondary"],
    ["success badge text", "success", "secondary"],
    ["warning badge text", "warning", "secondary"],
  ])("%s clears AA", (_label, fg, bg) => {
    expect(contrast(light[fg], light[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["primary", "primary-foreground"],
    ["destructive", "destructive-foreground"],
  ])("%s button label clears AA", (bg, fg) => {
    expect(contrast(light[fg], light[bg])).toBeGreaterThanOrEqual(4.5);
  });

  // The watched dot and status dots carry meaning with no text beside them,
  // which is the 3:1 graphical-object threshold.
  it.each(["success", "warning", "destructive", "primary"])(
    "the %s dot is distinguishable on a card",
    (token) => {
      expect(contrast(light[token], light.card)).toBeGreaterThanOrEqual(3);
    },
  );

  it("is actually light — otherwise the whole block is inert", () => {
    expect(luminance(light.background)).toBeGreaterThan(0.5);
    expect(luminance(dark.background)).toBeLessThan(0.05);
  });

  it("defines every token the dark palette does", () => {
    const colourish = (name: string) => name !== "radius";
    const missing = Object.keys(dark)
      .filter(colourish)
      .filter((name) => !(name in light));
    expect(missing).toEqual([]);
  });
});
