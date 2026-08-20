// The Radarr movie library list — configuration over the shared LibraryList.
import { formatBytes } from "../../../api/format";
import type { LibraryMovie } from "../../../api/types";
import { useLibraryMovies } from "../../../hooks/queries";
import { StateBadge } from "../../Blocks";
import { LibraryList } from "./list";

export function MovieLibrary() {
  const { data, error } = useLibraryMovies();

  return (
    <LibraryList<LibraryMovie & { status?: string }>
      kind="movies"
      items={data}
      error={error}
      // Radarr returns no single field for this, but the sort sheet offers
      // "status", so it has to exist on the row before sorting.
      prepare={(items) =>
        items.map((m) => ({
          ...m,
          status: m.has_file ? "downloaded" : m.monitored ? "wanted" : "unmonitored",
        }))
      }
      renderBadge={(m) => <StateBadge state={m.status ?? ""} />}
      renderStats={(m) => formatBytes(m.size_on_disk)}
      // Nothing to search for once the file is on disk.
      showSearch={(m) => !m.has_file}
    />
  );
}
