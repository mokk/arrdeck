import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { TitleSubtitles } from "../api/types";
import { useSubtitleDownload } from "../hooks/queries";
import { StateBadge } from "./Blocks";

/** One title's subtitles as Bazarr sees them: what is on disk, what its
 * language profile still wants, and a Get per missing language that asks
 * Bazarr to search the providers and download the best hit. */
export function SubtitleTracks({
  subtitles,
  target,
  compact,
}: {
  subtitles: TitleSubtitles | undefined;
  target: { kind: "movie"; id: number } | { kind: "episode"; id: number; series_id: number };
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const download = useSubtitleDownload();
  if (!subtitles) return null;
  if (!subtitles.tracked) {
    return <span className="text-xs text-muted-foreground">{t("subtitles.untracked")}</span>;
  }
  const present = subtitles.present ?? [];
  const missing = subtitles.missing ?? [];
  if (present.length === 0 && missing.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("subtitles.none")}</span>;
  }
  return (
    <div
      className={
        compact ? "flex flex-wrap items-center gap-1" : "flex flex-wrap items-center gap-1.5"
      }
    >
      {present.map((track) => (
        <StateBadge
          key={`p-${track.code}-${track.forced}-${track.hi}`}
          state={`${track.language}${track.hi ? " HI" : ""}${track.forced ? " F" : ""} ✓`}
          raw
        />
      ))}
      {missing.map((track) => (
        <Button
          key={`m-${track.code}-${track.forced}-${track.hi}`}
          size="sm"
          variant="secondary"
          className="h-6 rounded-full px-2 text-[0.68rem] text-primary"
          disabled={download.isPending}
          onClick={() =>
            download.mutate(
              target.kind === "movie"
                ? { kind: "movie", id: target.id, language: track.code }
                : {
                    kind: "episode",
                    id: target.id,
                    series_id: target.series_id,
                    language: track.code,
                  },
            )
          }
        >
          {t("subtitles.get", { language: track.language })}
        </Button>
      ))}
    </div>
  );
}
