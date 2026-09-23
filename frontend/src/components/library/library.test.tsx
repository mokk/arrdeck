import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setPref, usePref } from "../../lib/prefs";
import { Cover } from "./Cover";
import { letterOf } from "./LetterScrubber";

describe("letterOf", () => {
  it("takes the first letter, upper-cased", () => {
    expect(letterOf("dune")).toBe("D");
    expect(letterOf("  Ørnen")).toBe("Ø");
  });

  it("files digits, punctuation and blanks under #", () => {
    expect(letterOf("2001: A Space Odyssey")).toBe("#");
    expect(letterOf("(500) Days")).toBe("#");
    expect(letterOf(null)).toBe("#");
  });
});

describe("Cover", () => {
  it("shows the title when there is no artwork", () => {
    const { getByText } = render(<Cover title="Count Zero" subtitle="William Gibson" />);
    expect(getByText("Count Zero")).toBeTruthy();
    expect(getByText("William Gibson")).toBeTruthy();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    const { container, getByText } = render(<Cover src="/broken.jpg" title="Neuromancer" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("Neuromancer")).toBeTruthy();
  });
});

describe("prefs", () => {
  it("defaults, then follows setPref in every reader", () => {
    localStorage.removeItem("prefs.layout.movies");
    const { result } = renderHook(() => usePref("layout.movies"));
    expect(result.current).toBe("posters");
    act(() => setPref("layout.movies", "details"));
    expect(result.current).toBe("details");
    expect(localStorage.getItem("prefs.layout.movies")).toBe('"details"');
  });
});
