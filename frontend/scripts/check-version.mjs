// The backend is the single source of truth for arrdeck's version. package.json
// carried an independent "0.1.0" that had never been bumped, which is exactly the
// drift that makes a version-based capability check worthless.
//
// Run from the repo, not from `npm run build`: the image build stage copies only
// frontend/, so ../backend is not there. CI runs it alongside lint and tests.
import { readFileSync } from "node:fs";

const backend = readFileSync("../backend/app/version.py", "utf8");
const match = backend.match(/VERSION\s*=\s*"([^"]+)"/);
if (!match) {
  console.error("could not find VERSION in backend/app/version.py");
  process.exit(1);
}
const expected = match[1];
const actual = JSON.parse(readFileSync("package.json", "utf8")).version;
if (actual !== expected) {
  console.error(`version drift: package.json is ${actual}, backend is ${expected}`);
  process.exit(1);
}
console.log(`version ${expected} (matches backend)`);
