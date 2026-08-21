/** Notification text, written on the device rather than on the server.
 *
 * The server used to assemble these sentences in English and the service worker
 * showed them verbatim, so a Danish device got English banners — and a native
 * client could not localise a banner that arrives pre-rendered. The payload now
 * names what happened and the client writes the sentence. That is also the shape
 * APNs wants, where `loc-key` and `loc-args` are resolved from the app bundle.
 *
 * Lives outside sw.ts so it can be tested: importing the worker would run its
 * top-level `addEventListener` calls against a `self` that is not a
 * ServiceWorkerGlobalScope.
 *
 * Only the push strings are here, not the app's 436 — i18next is not loaded in
 * the worker and pulling it in for eight keys would be absurd. They are checked
 * against the backend event list by push-text.test.ts.
 */
const PUSH_STRINGS: Record<string, Record<string, string>> = {
  en: {
    grabbed: "Grabbed",
    imported: "Downloaded",
    upgraded: "Upgraded",
    failed: "Download failed",
    manual: "Needs manual import",
    health: "Health issue",
    added: "Added to library",
    test: "Test notification",
    count_radarr_one: "1 movie",
    count_radarr: "{n} movies",
    count_sonarr_one: "1 episode",
    count_sonarr: "{n} episodes",
    count_other_one: "1 item",
    count_other: "{n} items",
  },
  da: {
    grabbed: "Hentet",
    imported: "Downloadet",
    upgraded: "Opgraderet",
    failed: "Download fejlede",
    manual: "Kræver manuel import",
    health: "Helbredsproblem",
    added: "Tilføjet til biblioteket",
    test: "Testnotifikation",
    count_radarr_one: "1 film",
    count_radarr: "{n} film",
    count_sonarr_one: "1 afsnit",
    count_sonarr: "{n} afsnit",
    count_other_one: "1 element",
    count_other: "{n} elementer",
  },
};

type PushPayload = {
  code?: unknown;
  count?: unknown;
  app?: unknown;
  heading?: unknown;
  lang?: unknown;
  title?: unknown;
  body?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function counted(strings: Record<string, string>, app: string, count: number): string {
  // An app with no noun of its own falls back to "items" rather than rendering
  // a missing key.
  const base = `count_${app}` in strings ? `count_${app}` : "count_other";
  const key = count === 1 ? `${base}_one` : base;
  return (strings[key] ?? "").replace("{n}", String(count));
}

export function localise(data: PushPayload): { title: string; body: string } {
  const lang = text(data.lang) || "en";
  const strings = PUSH_STRINGS[lang] ?? PUSH_STRINGS.en;
  const label = strings[text(data.code)];

  // No code, or one this build has never heard of: use whatever the server
  // rendered. That keeps a newly added server-side event readable in an older
  // client instead of showing an empty banner.
  if (!label) return { title: text(data.title), body: text(data.body) };

  const count = typeof data.count === "number" && data.count > 0 ? data.count : 1;
  const heading = text(data.heading);
  if (count === 1) return { title: heading || label, body: label };

  const amount = counted(strings, text(data.app) || "other", count);
  // With a heading the label joins the count in the body; without one the label
  // becomes the heading — the same arrangement the server used to produce.
  return heading
    ? { title: heading, body: `${label} · ${amount}` }
    : { title: label, body: amount };
}
