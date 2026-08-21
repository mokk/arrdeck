/** The profiles card is read-only, so what matters is that it reports the arrs
 * faithfully: accepted qualities best-first, where upgrading stops, and an
 * honest answer when there are no custom formats — which is the case on a stock
 * setup, so an empty card would be the normal state rather than an edge one. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join("/")}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const state = vi.hoisted(() => ({ profiles: { data: undefined as unknown } }));

vi.mock("../../hooks/queries", () => ({
  useQualityProfiles: () => state.profiles,
  useTasks: () => ({ data: undefined }),
  useArrBackups: () => ({ data: undefined }),
  useServices: () => ({ data: [{ service: "radarr", configured: true }] }),
  useLogs: () => ({ data: [], isFetching: false }),
}));

import { SystemTab } from "./System";

const PROFILES = {
  profiles: [
    {
      id: 4,
      name: "HD-1080p",
      upgrade_allowed: true,
      cutoff: "Bluray-1080p",
      min_format_score: 0,
      items: [
        { name: "Remux-1080p", allowed: true, is_group: false, members: [], is_cutoff: false },
        { name: "Bluray-1080p", allowed: true, is_group: false, members: [], is_cutoff: true },
        {
          name: "WEB 1080p",
          allowed: true,
          is_group: true,
          members: ["WEBDL-1080p", "WEBRip-1080p"],
          is_cutoff: false,
        },
        { name: "SDTV", allowed: false, is_group: false, members: [], is_cutoff: false },
      ],
      format_scores: [],
    },
  ],
  custom_formats: [],
};

beforeEach(() => {
  state.profiles = { data: PROFILES };
});

describe("quality profiles card", () => {
  it("lists the accepted qualities and hides the rejected ones", () => {
    render(<SystemTab />);
    expect(screen.getByText("Remux-1080p")).toBeTruthy();
    expect(screen.getByText("Bluray-1080p")).toBeTruthy();
    expect(screen.queryByText("SDTV")).toBeNull();
  });

  it("offers to reveal the rejected ones, counted", () => {
    render(<SystemTab />);
    // One of the four items is disallowed.
    fireEvent.click(screen.getByText("system.showAllQualities:1"));
    expect(screen.getByText("SDTV")).toBeTruthy();
    fireEvent.click(screen.getByText("system.showAllowedOnly"));
    expect(screen.queryByText("SDTV")).toBeNull();
  });

  it("says where upgrading stops", () => {
    render(<SystemTab />);
    expect(screen.getByText("system.upgradeTo:Bluray-1080p")).toBeTruthy();
  });

  it("says so when a profile never upgrades", () => {
    // Every profile on a stock install has this off, so it is the common case.
    state.profiles = {
      data: {
        ...PROFILES,
        profiles: [{ ...PROFILES.profiles[0], upgrade_allowed: false }],
      },
    };
    render(<SystemTab />);
    expect(screen.getByText("system.noUpgrades")).toBeTruthy();
  });

  it("marks a grouped quality and names its members", () => {
    render(<SystemTab />);
    const group = screen.getByText(/WEB 1080p/);
    expect(group.getAttribute("title")).toBe("WEBDL-1080p, WEBRip-1080p");
  });

  it("states plainly that there are no custom formats", () => {
    render(<SystemTab />);
    expect(screen.getByText("system.noCustomFormats")).toBeTruthy();
  });

  it("lists custom formats when the arr has them", () => {
    state.profiles = { data: { ...PROFILES, custom_formats: ["HDR10", "Dolby Vision"] } };
    render(<SystemTab />);
    expect(screen.getByText("system.customFormats:HDR10, Dolby Vision")).toBeTruthy();
  });

  it("shows format scores with their sign", () => {
    state.profiles = {
      data: {
        ...PROFILES,
        profiles: [
          {
            ...PROFILES.profiles[0],
            format_scores: [
              { name: "Dolby Vision", score: 200 },
              { name: "BR-DISK", score: -100 },
            ],
          },
        ],
      },
    };
    render(<SystemTab />);
    expect(screen.getByText("+200")).toBeTruthy();
    expect(screen.getByText("-100")).toBeTruthy();
  });

  it("says so when the arr has no profiles at all", () => {
    state.profiles = { data: { profiles: [], custom_formats: [] } };
    render(<SystemTab />);
    expect(screen.getByText("system.noProfiles")).toBeTruthy();
  });
});
