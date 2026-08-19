import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// the dot only needs a title string; a real i18n instance would add nothing
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { WatchedDot } from "./WatchedDot";

const dot = (item: Parameters<typeof WatchedDot>[0]["item"]) =>
  render(<WatchedDot item={item} />).container.querySelector("span");

describe("WatchedDot", () => {
  it("renders nothing when plex has never seen the title", () => {
    // an unconfigured or unmatched library must look exactly as it did before
    expect(dot(undefined)).toBeNull();
  });

  it("renders nothing for a title that is simply unwatched", () => {
    expect(dot({ watched: false, progress: 0 })).toBeNull();
  });

  it("shows a solid dot when fully watched", () => {
    const el = dot({ watched: true, progress: 1 });
    expect(el).not.toBeNull();
    expect(el!.className).toContain("bg-success");
    expect(el!.className).not.toContain("bg-success/40");
  });

  it("shows a faded dot for a series part-way through", () => {
    const el = dot({ watched: false, progress: 0.5 });
    expect(el!.className).toContain("bg-success/40");
  });

  it("puts the progress in the tooltip so the dot isn't the only signal", () => {
    expect(dot({ watched: false, progress: 0.42 })!.getAttribute("title")).toBe(
      "manage.watchedPartial",
    );
    expect(dot({ watched: true, progress: 1 })!.getAttribute("title")).toBe("manage.watched");
  });
});
