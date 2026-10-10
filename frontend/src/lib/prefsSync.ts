// Keeps the display preferences in step with the server, so they follow you to
// other devices. Local storage stays the source the UI reads; this only copies
// between it and GET/PUT /prefs. Language is left out on purpose — it is chosen
// per device.
//
// Every run is the same three steps: read the server's copy, decide with
// decideSync, then adopt it or push ours. A change schedules a run a second
// later, so a burst of taps is one request, and only one run is ever in flight.
// A failed request changes nothing locally; the unsent change stays marked and
// goes out with the next run (next change, return to the app, back online).
import { useEffect } from "react";
import { api } from "../api/client";
import type { DisplayPrefs } from "../api/types";
import { hasStoredPrefs, onPrefChange, PREF_KEYS, readPref, storePrefs } from "./prefs";
import { decideSync } from "./prefsMerge";
import {
  hasStoredAppearance,
  PALETTES,
  type Palette,
  readPalette,
  readPreference,
  setPalette,
  setPreference,
  subscribeAppearance,
  type ThemePreference,
} from "./theme";

const STATE_KEY = "arrdeck.prefsSync";
const DEBOUNCE_MS = 1000;
// coming back to the app is when another device's change is most likely waiting
const REFRESH_AFTER_MS = 60_000;
const THEMES: ThemePreference[] = ["system", "dark", "light"];
const SYNCED = new Set<string>([...PREF_KEYS, "theme", "palette"]);

type State = { syncedAt: number; changedAt: number };

function readState(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
    return { syncedAt: Number(raw.syncedAt) || 0, changedAt: Number(raw.changedAt) || 0 };
  } catch {
    return { syncedAt: 0, changedAt: 0 };
  }
}

function writeState(state: State): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* without it the server's copy simply wins on the next start */
  }
}

/** What this device would send: every synced choice, defaults included, so a
 * reset travels too. */
function collect(): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of PREF_KEYS) values[key] = readPref(key);
  values.theme = readPreference();
  values.palette = readPalette();
  return values;
}

// Keys another client wrote that this one does not know. They go back with every
// push, otherwise an older client would erase a newer one's preferences.
let foreign: Record<string, unknown> = {};

function remember(values: Record<string, unknown>): void {
  foreign = Object.fromEntries(Object.entries(values).filter(([key]) => !SYNCED.has(key)));
}

// While server values are being written locally, the change hooks must not take
// them for something the user did.
let applying = false;

function adopt(server: Required<DisplayPrefs>): void {
  applying = true;
  try {
    storePrefs(server.values);
    const { theme, palette } = server.values;
    if (THEMES.includes(theme as ThemePreference)) setPreference(theme as ThemePreference);
    if (PALETTES.includes(palette as Palette)) setPalette(palette as Palette);
  } finally {
    applying = false;
  }
  remember(server.values);
  writeState({ syncedAt: server.updated_at, changedAt: 0 });
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function cycle(): Promise<void> {
  const server = await api.get<Required<DisplayPrefs>>("/prefs");
  const state = readState();
  const action = decideSync({
    serverAt: server.updated_at,
    syncedAt: state.syncedAt,
    changedAt: state.changedAt,
    hasLocalValues: hasStoredPrefs() || hasStoredAppearance(),
  });
  if (action === "apply") return adopt(server);
  remember(server.values);
  if (action === "none") return;

  const sent = state.changedAt || Date.now();
  const stored = await api.put<Required<DisplayPrefs>>("/prefs", {
    values: { ...foreign, ...collect() },
    updated_at: sent,
  });
  // changed again while the request was out: decide afresh, with both in view
  if (readState().changedAt !== state.changedAt) {
    again = true;
    return;
  }
  // a later updated_at than the one sent means another device's write won
  if (stored.updated_at > sent) return adopt(stored);
  remember(stored.values);
  writeState({ syncedAt: stored.updated_at, changedAt: 0 });
}

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await cycle();
    } while (again);
  } catch {
    /* offline, signed out or the server is down: local choices are untouched */
  } finally {
    running = false;
  }
}

function schedule(delay: number): void {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function localChange(): void {
  if (applying) return;
  const { syncedAt, changedAt } = readState();
  // Strictly increasing, so two changes in one millisecond are still ordered, and
  // never earlier than the copy it follows: a clock running behind the server's
  // would otherwise see the user's change lose to a version it was made after.
  writeState({ syncedAt, changedAt: Math.max(Date.now(), changedAt + 1, syncedAt + 1) });
  schedule(DEBOUNCE_MS);
}

function start(): () => void {
  let lastRun = Date.now();
  const refresh = () => {
    lastRun = Date.now();
    schedule(0);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRun > REFRESH_AFTER_MS) {
      refresh();
    }
  };
  const stops = [onPrefChange(localChange), subscribeAppearance(localChange)];
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", refresh);
  refresh();
  return () => {
    for (const stop of stops) stop();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", refresh);
    clearTimeout(timer);
  };
}

/** Starts syncing once the API can be reached: on a LAN host, or signed in. */
export function usePrefsSync(enabled: boolean): void {
  useEffect(() => (enabled ? start() : undefined), [enabled]);
}
