/** Picking what an unplaceable file is: for Readarr that is a book, found by
 * its title or its author, and the pick carries the book id the import needs. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

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
