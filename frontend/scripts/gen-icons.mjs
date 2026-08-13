// Rasterize the app icon SVG into the PNG sizes PWA/iOS need.
// Run: node scripts/gen-icons.mjs   (regenerates into public/)
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "icon-square.svg");
const out = (name) => path.join(here, "..", "public", name);

const targets = [
  ["apple-touch-icon.png", 180],
  ["pwa-192.png", 192],
  ["pwa-512.png", 512],
];

for (const [name, size] of targets) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(out(name));
  console.log(`${name} (${size}x${size})`);
}
