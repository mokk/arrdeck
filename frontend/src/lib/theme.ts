/** Theme preference. "system" follows the OS; the other two pin it.
 *
 * The resolved value lands on <html data-theme>, which is also what the boot
 * script in index.html writes before first paint. Keeping the key and the
 * resolution rule in one place is the point: two copies would drift and the
 * flash would come back. */
export type ThemePreference = "system" | "dark" | "light";

const THEME_KEY = "arrdeck.theme";
const PALETTE_KEY = "arrdeck.palette";

/** The editor palettes. arrdeck's own is the default and has no attribute. */
export const PALETTES = [
  "arrdeck",
  "catppuccin",
  "dracula",
  "nord",
  "gruvbox",
  "solarized",
  "tokyonight",
  "onedark",
  "rosepine",
] as const;
export type Palette = (typeof PALETTES)[number];

/** Palettes with no official light variant: choosing one pins dark. */
export const DARK_ONLY: ReadonlySet<Palette> = new Set(["dracula"]);

export function readPalette(): Palette {
  const stored = localStorage.getItem(PALETTE_KEY) as Palette | null;
  return stored && PALETTES.includes(stored) ? stored : "arrdeck";
}

const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

function resolveTheme(preference: ThemePreference): "dark" | "light" {
  if (DARK_ONLY.has(readPalette())) return "dark";
  if (preference !== "system") return preference;
  // Dark is the default, so only an explicit light preference flips it — a
  // browser with no matchMedia support stays on the palette the app was built
  // against rather than guessing.
  return window.matchMedia?.(LIGHT_QUERY).matches ? "light" : "dark";
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  const palette = readPalette();
  if (palette === "arrdeck") delete root.dataset.palette;
  else root.dataset.palette = palette;
  // The browser paints its own chrome (iOS status bar, Android address bar)
  // from this, so a stale value is visible even though nothing in the page is.
  const background = getComputedStyle(root).getPropertyValue("--background").trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background || (resolved === "light" ? "#f4f6fa" : "#0f1219"));
}

/** Re-reads both choices; main.tsx calls it once the stylesheet is in, so the
 * browser chrome picks up the palette's background. */
export function refreshTheme(): void {
  applyTheme(readPreference());
}

export function setPalette(palette: Palette): void {
  if (palette === "arrdeck") localStorage.removeItem(PALETTE_KEY);
  else localStorage.setItem(PALETTE_KEY, palette);
  applyTheme(readPreference());
}

export function setPreference(preference: ThemePreference): void {
  if (preference === "system") localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
}

/** Keep "system" live: the OS can change appearance while the app is open, and
 * on a phone it does so every evening. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia?.(LIGHT_QUERY);
  if (!media) return () => {};
  const onChange = () => {
    if (readPreference() === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
