/** The import sheet moves real media: it must send exactly what was picked in
 * one request, then report what the arr says happened rather than "started". */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({
  candidates: [] as unknown[],
  command: undefined as unknown,
  assign: vi.fn(),
}));
vi.mock("../hooks/queries", () => ({
  useImportCandidates: () => ({ data: state.candidates, isLoading: false }),
  useManualImportAssign: () => ({ mutate: state.assign, isPending: false }),
  useImportCommand: () => ({ data: state.command }),
}));
vi.mock("./TargetPicker", () => ({ TargetPicker: () => null }));

import { ImportSheet } from "./ImportSheet";

const candidate = (over: Record<string, unknown> = {}) => ({
  path: "/data/Movies/Dune/Dune.mkv",
  name: "Dune.mkv",
  size: 1,
  title: "Dune",
  quality: "WEBDL-1080p",
  languages: ["English"],
  rejections: [],
  importable: true,
  ...over,
});

const started = { app: "radarr", id: 77, status: "queued", done: false, ok: null };

beforeEach(() => {
  state.candidates = [candidate()];
  state.command = undefined;
  state.assign.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

function openAndImport() {
  render(<ImportSheet app="radarr" itemId={3} onClose={() => {}} />);
  fireEvent.click(screen.getByText("dl.selectAll"));
  fireEvent.click(screen.getByText("dl.importSelected(1)"));
  const [, options] = state.assign.mock.calls[0];
  act(() => options.onSuccess(started));
}

describe("import sheet", () => {
  it("sends the picked files in one request", () => {
    openAndImport();
    expect(state.assign).toHaveBeenCalledTimes(1);
    expect(state.assign.mock.calls[0][0]).toEqual({
      app: "radarr",
      itemId: 3,
      files: [{ path: "/data/Movies/Dune/Dune.mkv" }],
    });
  });

  it("says it is importing until the arr's command finishes", () => {
    openAndImport();
    expect(screen.getByRole("status").textContent).toContain("dl.importing");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports the count the arr gives once it is done", () => {
    state.command = { ...started, status: "completed", done: true, ok: true, imported: 2 };
    openAndImport();
    expect(screen.getByRole("status").textContent).toBe("dl.importedFiles(2)");
    expect(toast.success).toHaveBeenCalledWith("dl.importedFiles(2)");
  });

  it("shows the arr's own error when the import fails", () => {
    state.command = {
      ...started,
      status: "failed",
      done: true,
      ok: false,
      message: "System.IO.IOException: Disk full",
    };
    openAndImport();
    expect(screen.getByRole("status").textContent).toBe("System.IO.IOException: Disk full");
    expect(toast.error).toHaveBeenCalledWith("System.IO.IOException: Disk full");
  });
});
