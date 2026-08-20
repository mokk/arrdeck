import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Static guards for the accessibility gaps phase K closed. These are the kind
 * of thing that silently reappears the next time someone adds a button. */

function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

const files = sources().map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("icon-only buttons", () => {
  it("all have an accessible name", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!/size="icon/.test(line)) return;
        // the name can sit a few lines either side of the size prop
        const window = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
        if (!/aria-label=/.test(window)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("glyph-only buttons", () => {
  it("never rely on ✕ alone for their name", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("✕")) return;
        const window = lines.slice(Math.max(0, i - 8), i + 2).join("\n");
        if (!/aria-label=/.test(window)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("hand-rolled buttons", () => {
  it("show a focus ring, since they don't inherit the Button component's", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!/<button\b/.test(line)) return;
        const window = lines.slice(i, i + 14).join("\n");
        // a hidden file input's label wrapper has nothing to focus
        if (/className="hidden"/.test(window)) return;
        if (!/focus-visible:|focusRing/.test(window)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("colour-only signals", () => {
  it("the watched dot carries a text alternative", () => {
    const dot = readFileSync("src/components/WatchedDot.tsx", "utf8");
    expect(dot).toMatch(/aria-label=/);
    expect(dot).toMatch(/role="img"/);
  });
});
