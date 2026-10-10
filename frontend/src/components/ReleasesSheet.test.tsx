/** Interactive search: the sheet must make a rejection legible, and the filters
 * must narrow the list without ever touching the grab call. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const state = vi.hoisted(() => ({ data: [] as unknown[], grab: vi.fn() }));
vi.mock("../hooks/queries", () => ({
  useArrReleases: () => ({ data: state.data, error: undefined, isLoading: false }),
  useGrabArrRelease: () => ({ mutate: state.grab, isPending: false }),
}));

import { ReleasesSheet } from "./ReleasesSheet";

const base = { indexer_id: 3, indexer: "NZBgeek", approved: true };

function open() {
  return render(
    <ReleasesSheet app="radarr" params={{ movieId: 1 }} title="Dune" onClose={() => {}} />,
  );
}

const order = () =>
  screen.getAllByText(/^(Big|Small|Rejected)\./).map((el) => el.textContent?.split(".")[0]);

beforeEach(() => {
  localStorage.clear();
  state.grab.mockClear();
  state.data = [
    {
      ...base,
      guid: "a",
      title: "Big.2160p.REMUX-FraMeSToR",
      quality: "Remux-2160p",
      size: 60e9,
      seeders: 5,
      release_group: "FraMeSToR",
      custom_format_score: 1750,
      custom_formats: ["HDR"],
      protocol: "usenet",
    },
    {
      ...base,
      guid: "b",
      title: "Small.1080p.WEB-DL-NTb",
      quality: "WEBDL-1080p",
      size: 4e9,
      seeders: 90,
    },
    {
      ...base,
      guid: "c",
      approved: false,
      title: "Rejected.720p.HDTV",
      size: 2e9,
      seeders: 300,
      custom_format_score: -10000,
      rejections: ["Not an upgrade for existing file", "Quality is not wanted"],
    },
  ];
});

describe("releases sheet", () => {
  it("shows every rejection reason, the release group and the format score", () => {
    open();
    expect(screen.getByText("Not an upgrade for existing file")).toBeTruthy();
    expect(screen.getByText("Quality is not wanted")).toBeTruthy();
    expect(screen.getByText("FraMeSToR")).toBeTruthy();
    expect(screen.getByText("+1750")).toBeTruthy();
    expect(screen.getByText("-10000")).toBeTruthy();
  });

  it("keeps the server order by default, rejected last", () => {
    open();
    expect(order()).toEqual(["Big", "Small", "Rejected"]);
  });

  it("applies the sort it persisted", () => {
    localStorage.setItem("releases.sort", JSON.stringify("seeders"));
    open();
    expect(order()).toEqual(["Small", "Big", "Rejected"]);
  });

  it("filters on the title text and on approval", () => {
    open();
    fireEvent.change(screen.getByLabelText("releases.filterTitle"), {
      target: { value: "web" },
    });
    expect(order()).toEqual(["Small"]);
    fireEvent.change(screen.getByLabelText("releases.filterTitle"), { target: { value: "" } });
    fireEvent.click(screen.getByText("releases.approvedOnly"));
    expect(order()).toEqual(["Big", "Small"]);
  });

  it("filters on a size range typed in GB", () => {
    open();
    fireEvent.change(screen.getByLabelText("releases.minSize"), { target: { value: "10" } });
    expect(order()).toEqual(["Big"]);
  });

  it("says so, and offers a reset, when the filters hide everything", () => {
    open();
    fireEvent.change(screen.getByLabelText("releases.filterTitle"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/releases\.noMatch/)).toBeTruthy();
    fireEvent.click(screen.getByText("releases.clearFilters"));
    expect(order()).toHaveLength(3);
  });

  it("grabs with the release's own guid and indexer", () => {
    open();
    fireEvent.click(screen.getAllByText("add.grab")[1]);
    expect(state.grab.mock.calls[0][0]).toEqual({ guid: "b", indexer_id: 3 });
  });
});
