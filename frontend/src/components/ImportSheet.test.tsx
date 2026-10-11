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
  torrentImport: vi.fn(),
  torrentCandidates: undefined as unknown,
  torrentError: null as Error | null,
}));
vi.mock("../hooks/queries", () => ({
  useImportCandidates: () => ({ data: state.candidates, isLoading: false }),
  useManualImportAssign: () => ({ mutate: state.assign, isPending: false }),
  useTorrentImport: () => ({ mutate: state.torrentImport, isPending: false }),
  useTorrentImportCandidates: (_app: string, torrent: unknown) => ({
    data: torrent ? state.torrentCandidates : undefined,
    isLoading: false,
    error: torrent ? state.torrentError : null,
  }),
  useImportCommand: () => ({ data: state.command }),
  useImportOptions: () => ({
    data: {
      qualities: [
        { id: 3, name: "WEBDL-1080p" },
        { id: 7, name: "Bluray-1080p" },
      ],
      languages: [
        { id: 1, name: "English" },
        { id: 11, name: "Danish" },
      ],
    },
  }),
}));
vi.mock("./TargetPicker", () => ({ TargetPicker: () => null }));
const asked = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("./Confirm", () => ({
  useConfirm: () => async (ask: Record<string, unknown>) => {
    asked.push(ask);
    return true;
  },
}));

/** A click whose handler awaits the confirmation before it acts. */
async function press(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

import { ImportSheet } from "./ImportSheet";

const candidate = (over: Record<string, unknown> = {}) => ({
  path: "/data/Movies/Dune/Dune.mkv",
  name: "Dune.mkv",
  size: 1,
  title: "Dune",
  quality: "WEBDL-1080p",
  quality_id: 3,
  languages: ["English"],
  language_ids: [1],
  rejections: [],
  importable: true,
  ...over,
});

const started = { app: "radarr", id: 77, status: "queued", done: false, ok: null };

beforeEach(() => {
  asked.length = 0;
  state.candidates = [candidate()];
  state.command = undefined;
  state.assign.mockReset();
  state.torrentImport.mockReset();
  state.torrentCandidates = [candidate()];
  state.torrentError = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

async function openAndImport() {
  render(<ImportSheet app="radarr" itemId={3} onClose={() => {}} />);
  fireEvent.click(screen.getByText("dl.selectAll"));
  await press(screen.getByText("dl.importSelected(1)"));
  const [, options] = state.assign.mock.calls[0];
  act(() => options.onSuccess(started));
}

describe("import sheet", () => {
  it("sends the picked files in one request, after asking whatever the setting says", async () => {
    await openAndImport();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ destructive: true, always: true });
    expect(state.assign).toHaveBeenCalledTimes(1);
    expect(state.assign.mock.calls[0][0]).toEqual({
      app: "radarr",
      itemId: 3,
      files: [{ path: "/data/Movies/Dune/Dune.mkv" }],
      mode: "auto",
    });
  });

  it("says it is importing until the arr's command finishes", async () => {
    await openAndImport();
    expect(screen.getByRole("status").textContent).toContain("dl.importing");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports the count the arr gives once it is done", async () => {
    state.command = { ...started, status: "completed", done: true, ok: true, imported: 2 };
    await openAndImport();
    expect(screen.getByRole("status").textContent).toBe("dl.importedFiles(2)");
    expect(toast.success).toHaveBeenCalledWith("dl.importedFiles(2)");
  });

  it("shows the arr's own error when the import fails", async () => {
    state.command = {
      ...started,
      status: "failed",
      done: true,
      ok: false,
      message: "System.IO.IOException: Disk full",
    };
    await openAndImport();
    expect(screen.getByRole("status").textContent).toBe("System.IO.IOException: Disk full");
    expect(toast.error).toHaveBeenCalledWith("System.IO.IOException: Disk full");
  });
});

describe("quality and language", () => {
  it("shows the arr's detection and sends nothing extra when left alone", async () => {
    await openAndImport();
    expect(screen.getByText(/WEBDL-1080p · English/)).toBeTruthy();
    expect(state.assign.mock.calls[0][0].files[0]).toEqual({
      path: "/data/Movies/Dune/Dune.mkv",
    });
  });

  it("sends a language picked for one file with that file", async () => {
    render(<ImportSheet app="radarr" itemId={3} onClose={() => {}} />);
    fireEvent.click(screen.getByText("dl.change"));
    fireEvent.click(screen.getByRole("button", { name: "Danish" }));
    fireEvent.click(screen.getByText("dl.done"));
    expect(screen.getByText(/WEBDL-1080p · English · Danish/)).toBeTruthy();
    fireEvent.click(screen.getByText("dl.selectAll"));
    await press(screen.getByText("dl.importSelected(1)"));
    expect(state.assign.mock.calls[0][0].files[0]).toEqual({
      path: "/data/Movies/Dune/Dune.mkv",
      language_ids: [1, 11],
    });
  });
});

describe("a finished torrent", () => {
  const torrent = { client: "qbittorrent", id: "c095", name: "Dune.2021.1080p" };

  it("imports from the torrent, naming only the torrent, with auto by default", async () => {
    render(<ImportSheet app="radarr" torrent={torrent} onClose={() => {}} />);
    fireEvent.click(screen.getByText("dl.selectAll"));
    await press(screen.getByText("dl.importSelected(1)"));
    expect(state.assign).not.toHaveBeenCalled();
    expect(state.torrentImport.mock.calls[0][0]).toEqual({
      app: "radarr",
      client: "qbittorrent",
      torrentId: "c095",
      files: [{ path: "/data/Movies/Dune/Dune.mkv" }],
      mode: "auto",
    });
  });

  it("moves only when asked, and warns that seeding stops", async () => {
    render(<ImportSheet app="radarr" torrent={torrent} onClose={() => {}} />);
    expect(screen.queryByText("dl.moveWarning")).toBeNull();
    fireEvent.click(screen.getByText("dl.moveInstead"));
    expect(screen.getByText("dl.moveWarning")).toBeTruthy();
    fireEvent.click(screen.getByText("dl.selectAll"));
    await press(screen.getByText("dl.moveSelected(1)"));
    expect(state.torrentImport.mock.calls[0][0].mode).toBe("move");
  });

  it("shows why the arr can't take it", async () => {
    state.torrentCandidates = undefined;
    state.torrentError = new Error("Radarr can't see /downloads/x");
    render(<ImportSheet app="radarr" torrent={torrent} onClose={() => {}} />);
    expect(screen.getByText("Radarr can't see /downloads/x")).toBeTruthy();
  });
});
