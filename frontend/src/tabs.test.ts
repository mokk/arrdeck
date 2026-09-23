import { describe, expect, it } from "vitest";
import { tabFor, tabsFor } from "./tabs";

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

describe("tabFor", () => {
  it("lights the library a detail page belongs to", () => {
    expect(tabFor("/movie/12")).toBe("/movies");
    expect(tabFor("/series/3")).toBe("/shows");
    expect(tabFor("/book/7")).toBe("/books");
    expect(tabFor("/author/3")).toBe("/books");
  });

  it("lights the library Add was opened for", () => {
    expect(tabFor("/add", "?tab=series")).toBe("/shows");
    expect(tabFor("/add", "?tab=books")).toBe("/books");
    expect(tabFor("/add")).toBe("/movies");
  });

  it("files the Settings sub-screens under Settings", () => {
    expect(tabFor("/overview")).toBe("/settings");
    expect(tabFor("/settings/connections")).toBe("/settings");
    expect(tabFor("/wanted")).toBe("/settings");
  });

  it("leaves the tabs themselves alone", () => {
    expect(tabFor("/activity")).toBe("/activity");
    expect(tabFor("/calendar")).toBe("/calendar");
  });
});
