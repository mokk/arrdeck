// The Sonarr series library list — configuration over the shared LibraryList.
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../../api/format";
import type { LibrarySeries } from "../../../api/types";
import { useLibrarySeries } from "../../../hooks/queries";
import { StateBadge } from "../../Blocks";
import { LibraryList } from "./list";

export function SeriesLibrary() {
  const { t } = useTranslation();
  const { data, error } = useLibrarySeries();

  return (
    <LibraryList<LibrarySeries>
      kind="series"
      items={data}
      error={error}
      // Sonarr does return a `status` field, which is what the sort sheet sorts
      // on, but the badge has always shown monitored state instead.
      renderBadge={(s) => <StateBadge state={s.monitored ? "ok" : "paused"} />}
      renderStats={(s) => (
        <>
          {t("manage.episodes", { files: s.episode_file_count, total: s.episode_count })} ·{" "}
          {formatBytes(s.size_on_disk)}
        </>
      )}
      posterOpens
    />
  );
}
