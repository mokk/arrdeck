/** Notification text is now written on the device. A wrong sentence here is a
 * banner the user reads on their lock screen, so the sentence-building is worth
 * pinning — including the fallbacks, which are what keep an old client readable
 * against a newer server. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localise } from "./push-text";

describe("a single event", () => {
  it("leads with the media title and explains underneath", () => {
    const out = localise({ code: "imported", count: 1, app: "radarr", heading: "Dune (2021)" });
    expect(out).toEqual({ title: "Dune (2021)", body: "Downloaded" });
  });

  it("uses the label as the heading when there is no media title", () => {
    const out = localise({ code: "health", count: 1, app: "radarr", heading: "" });
    expect(out).toEqual({ title: "Health issue", body: "Health issue" });
  });

  it("renders in Danish when the device is Danish", () => {
    // The whole point: this device used to get English regardless.
    const out = localise({
      code: "imported",
      count: 1,
      app: "radarr",
      heading: "Dune",
      lang: "da",
    });
    expect(out).toEqual({ title: "Dune", body: "Downloadet" });
  });
});

describe("a collapsed burst", () => {
  it("keeps the series as the heading and counts in the body", () => {
    const out = localise({ code: "imported", count: 8, app: "sonarr", heading: "The Bear" });
    expect(out).toEqual({ title: "The Bear", body: "Downloaded · 8 episodes" });
  });

  it("counts in Danish", () => {
    const out = localise({
      code: "imported",
      count: 8,
      app: "sonarr",
      heading: "The Bear",
      lang: "da",
    });
    expect(out).toEqual({ title: "The Bear", body: "Downloadet · 8 afsnit" });
  });

  it("promotes the label to the heading when there is no series", () => {
    const out = localise({ code: "imported", count: 3, app: "radarr", heading: "" });
    expect(out).toEqual({ title: "Downloaded", body: "3 movies" });
  });

  it("uses the singular noun at a count of one", () => {
    // A collapsed group can be flushed with one member; "1 movies" would show.
    const out = localise({ code: "imported", count: 2, app: "radarr", heading: "" });
    expect(out.body).toBe("2 movies");
    expect(localise({ code: "grabbed", count: 1, app: "radarr", heading: "" }).body).toBe(
      "Grabbed",
    );
  });

  it("falls back to a generic noun for an app with none of its own", () => {
    const out = localise({ code: "imported", count: 4, app: "bazarr", heading: "" });
    expect(out.body).toBe("4 items");
  });
});

describe("fallbacks", () => {
  it("uses the server's rendering for a code this build does not know", () => {
    // A server can add an event before the client ships a string for it. Showing
    // the server's English is better than showing nothing.
    const out = localise({
      code: "some_future_event",
      count: 1,
      heading: "x",
      title: "Server title",
      body: "Server body",
    });
    expect(out).toEqual({ title: "Server title", body: "Server body" });
  });

  it("uses the server's rendering when there is no code at all", () => {
    const out = localise({ title: "Old payload", body: "No code here" });
    expect(out).toEqual({ title: "Old payload", body: "No code here" });
  });

  it("falls back to English for a language it has no strings for", () => {
    const out = localise({
      code: "imported",
      count: 1,
      app: "radarr",
      heading: "x",
      lang: "de",
    });
    expect(out.body).toBe("Downloaded");
  });

  it("survives a payload of the wrong shape rather than throwing", () => {
    // event.data.json() is whatever the server sent; a worker that throws here
    // shows no notification at all.
    expect(localise({})).toEqual({ title: "", body: "" });
    expect(localise({ code: 42, count: "many", heading: null })).toEqual({
      title: "",
      body: "",
    });
  });

  it("treats a nonsense count as one", () => {
    expect(localise({ code: "imported", count: 0, app: "radarr", heading: "x" }).body).toBe(
      "Downloaded",
    );
    expect(localise({ code: "imported", count: -3, app: "radarr", heading: "x" }).body).toBe(
      "Downloaded",
    );
  });
});

describe("coverage of what the backend can send", () => {
  // Asserted through localise() rather than by reading the string table: the
  // table is not exported, and behaviour is the thing that matters — a missing
  // string shows as the server's English fallback, which is exactly what these
  // check for.
  const backend = readFileSync("../backend/app/push/events.py", "utf8");

  function backendKeys(marker: string): string[] {
    const block = backend.slice(backend.indexOf(marker));
    return [...block.slice(0, block.indexOf("}")).matchAll(/"(\w+)":/g)].map((m) => m[1]);
  }

  it.each(["en", "da"])("%s has a string for every event the backend sends", (lang) => {
    const keys = backendKeys("EVENT_LABELS = {");
    expect(keys.length).toBeGreaterThan(0);
    for (const code of keys) {
      const out = localise({
        code,
        count: 1,
        heading: "",
        lang,
        title: "FELL_BACK",
        body: "FELL_BACK",
      });
      expect(out.body, `${lang} has no string for ${code}`).not.toBe("FELL_BACK");
    }
  });

  it.each(["en", "da"])("%s has a plural noun for every app the backend counts", (lang) => {
    const apps = backendKeys("NOUNS = {");
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      const out = localise({ code: "imported", count: 3, app, heading: "", lang });
      // A missing noun would fall through to the generic "items" wording.
      expect(out.body, `${lang} has no noun for ${app}`).toContain("3");
      expect(out.body).not.toMatch(/items|elementer/);
    }
  });

  it("distinguishes the two languages, so a missing table is not silently English", () => {
    const en = localise({ code: "imported", count: 1, heading: "", lang: "en" });
    const da = localise({ code: "imported", count: 1, heading: "", lang: "da" });
    expect(en.body).not.toBe(da.body);
  });
});
