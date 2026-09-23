import { describe, expect, it } from "vitest";
import { tabsFor } from "./tabs";

/** The bar is derived from the configured services, so a library tab for a
 * service that is not set up would be an empty page with no way to fill it. */
describe("tabsFor", () => {
  const paths = (configured: string[]) => tabsFor(new Set(configured)).map((t) => t.to);

  it("offers only Settings until a service is configured", () => {
    expect(paths([])).toEqual(["/settings"]);
  });

  it("gates each library on its own service", () => {
    expect(paths(["readarr"])).toEqual(["/books", "/activity", "/calendar", "/settings"]);
    expect(paths(["sonarr"])).toEqual(["/shows", "/activity", "/calendar", "/settings"]);
  });

  it("shows Activity for a bare download client, but not Calendar", () => {
    expect(paths(["qbittorrent"])).toEqual(["/activity", "/settings"]);
  });

  it("keeps the fixed order regardless of configuration order", () => {
    expect(paths(["sonarr", "readarr", "radarr", "transmission"])).toEqual([
      "/books",
      "/movies",
      "/shows",
      "/activity",
      "/calendar",
      "/settings",
    ]);
  });
});
