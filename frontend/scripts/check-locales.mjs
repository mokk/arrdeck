// Fails the build when en/da translation key sets drift apart.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const load = (l) => JSON.parse(readFileSync(join(here, `../src/locales/${l}.json`), "utf8"));

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const en = new Set(flatten(load("en")));
const da = new Set(flatten(load("da")));
const missingInDa = [...en].filter((k) => !da.has(k));
const missingInEn = [...da].filter((k) => !en.has(k));
if (missingInDa.length || missingInEn.length) {
  if (missingInDa.length) console.error("missing in da.json:", missingInDa.join(", "));
  if (missingInEn.length) console.error("missing in en.json:", missingInEn.join(", "));
  process.exit(1);
}
console.log(`locales in sync (${en.size} keys)`);
