import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { WatchedItem } from "../api/types";

/** A filled dot for fully watched, a half-filled one for a show in progress.
 * Renders nothing when Plex has never seen the title, so an unconfigured or
 * unmatched library looks the same as it did before. */
export function WatchedDot({ item }: { item: WatchedItem | undefined }) {
  const { t } = useTranslation();
  if (!item) return null;
  const partial = !item.watched && (item.progress ?? 0) > 0;
  // colour alone carried the meaning; give assistive tech the same information
  const label = item.watched
    ? t("manage.watched")
    : t("manage.watchedPartial", { percent: Math.round((item.progress ?? 0) * 100) });
  if (!item.watched && !partial) return null;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        item.watched ? "bg-success" : "bg-success/40",
      )}
    />
  );
}
