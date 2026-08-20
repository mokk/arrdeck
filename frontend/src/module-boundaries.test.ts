import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The 400-line split was mechanical and its script exported everything it
 * moved, leaving a dozen internal helpers reachable from anywhere. This fails
 * when an export has no consumer outside its own file, so a future split can't
 * quietly reintroduce that. */

function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(path) && !/\.test\./.test(path) && !path.includes("generated")
      ? [path]
      : [];
  });
}

const files = sources().map((path) => ({ path, text: readFileSync(path, "utf8") }));

// Barrels exist precisely to re-export, and entry points are used by the
// bundler rather than by another module.
const EXEMPT = new Set([
  "src/hooks/queries.ts",
  "src/api/types.ts",
  "src/components/manage/Libraries.tsx",
  "src/main.tsx",
  "src/App.tsx",
  "src/sw.ts",
  "src/i18n.ts",
  "src/test-setup.ts",
]);

describe("module boundaries", () => {
  it("every export has a consumer outside its own file", () => {
    const orphans: string[] = [];
    for (const { path, text } of files) {
      if (EXEMPT.has(path) || path.includes("/components/ui/")) continue;
      for (const m of text.matchAll(/^export (?:const|function|type|class) (\w+)/gm)) {
        const name = m[1];
        const used = files.some(
          (f) => f.path !== path && new RegExp(`\\b${name}\\b`).test(f.text),
        );
        if (!used) orphans.push(`${name} (${path})`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("no default export outside pages, so imports name what they get", () => {
    const offenders = files
      .filter(({ path }) => !path.startsWith("src/pages/") && !EXEMPT.has(path))
      .filter(({ text }) => /^export default/m.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
