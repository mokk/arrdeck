/** Picking what an unplaceable file is: for Readarr that is a book, found by
 * its title or its author, and the pick carries the book id the import needs;
 * for Lidarr an artist and then one of their albums. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const albumsFor = vi.hoisted(() => vi.fn());
vi.mock("../hooks/queries", () => ({
  useLibraryMovies: () => ({ data: [] }),
  useLibrarySeries: () => ({ data: [] }),
  useSeriesEpisodes: () => ({ data: [] }),
  useLibraryBooks: () => ({
    data: [
      { id: 8, title: "Atomvaner", author: "James Clear" },
      { id: 9, title: "Journal 64", author: "Jussi Adler-Olsen" },
    ],
  }),
  useLibraryArtists: () => ({
    data: [
      { id: 1, name: "Boards of Canada", album_count: 5 },
      { id: 2, name: "Autechre", album_count: 15 },
    ],
  }),
  useArtistAlbums: (artistId: number | null) => {
    albumsFor(artistId);
    return {
      data:
        artistId === 1
          ? [
              { id: 5, title: "Inferno", year: 2026, track_count: 19 },
              { id: 1, title: "Geogaddi", year: 2002, track_count: 24 },
            ]
          : [],
    };
  },
}));

import { TargetPicker } from "./TargetPicker";

describe("book target", () => {
  it("finds a book by its author and hands back its id", () => {
    const onPick = vi.fn();
    render(<TargetPicker app="readarr" onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("dl.filterBooks"), {
      target: { value: "clear" },
    });
    expect(screen.queryByText("Journal 64")).toBeNull();
    fireEvent.click(screen.getByText("Atomvaner"));
    expect(onPick).toHaveBeenCalledWith({ book_id: 8, label: "Atomvaner — James Clear" });
  });
});

describe("album target", () => {
  it("drills from an artist into their albums and hands back the album id", () => {
    const onPick = vi.fn();
    render(<TargetPicker app="lidarr" onPick={onPick} onClose={() => {}} />);
    // nothing is asked of Lidarr's albums until an artist is chosen
    expect(albumsFor).not.toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByPlaceholderText("dl.filterArtists"), {
      target: { value: "boards" },
    });
    expect(screen.queryByText("Autechre")).toBeNull();
    fireEvent.click(screen.getByText("Boards of Canada"));
    expect(albumsFor).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByPlaceholderText("dl.filterAlbums"), {
      target: { value: "geo" },
    });
    expect(screen.queryByText("Inferno")).toBeNull();
    fireEvent.click(screen.getByText("Geogaddi"));
    expect(onPick).toHaveBeenCalledWith({ album_id: 1, label: "Boards of Canada — Geogaddi" });
  });

  it("goes back to the artists", () => {
    render(<TargetPicker app="lidarr" onPick={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Boards of Canada"));
    fireEvent.click(screen.getByText("common.back"));
    expect(screen.getByText("Autechre")).toBeTruthy();
  });
});
