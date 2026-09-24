// Which episodes of a new show Sonarr should monitor: one of Sonarr's own
// presets, or exactly the seasons picked here.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, focusRing } from "@/lib/utils";
import { useSeriesSeasons } from "../../hooks/queries";

const MONITOR_PRESETS = [
  "all",
  "future",
  "missing",
  "existing",
  "recent",
  "pilot",
  "firstSeason",
  "lastSeason",
  "none",
] as const;
export type MonitorChoice = (typeof MONITOR_PRESETS)[number] | "pick";

export function SeriesMonitor({
  tvdbId,
  choice,
  onChoice,
  picked,
  onPicked,
}: {
  tvdbId: number;
  choice: MonitorChoice;
  onChoice: (c: MonitorChoice) => void;
  /** null until the seasons have loaded: then every regular season */
  picked: Set<number> | null;
  onPicked: (s: Set<number>) => void;
}) {
  const { t } = useTranslation();
  const { data: seasons, isLoading } = useSeriesSeasons(tvdbId, choice === "pick");
  const regular = (seasons ?? []).filter((n) => n > 0);
  const current = picked ?? new Set(regular);
  const toggle = (n: number) => {
    const next = new Set(current);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onPicked(next);
  };
  return (
    <>
      <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">{t("add.monitor")}</Label>
      <Select value={choice} onValueChange={(v) => onChoice(v as MonitorChoice)}>
        <SelectTrigger className="w-full bg-secondary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONITOR_PRESETS.map((m) => (
            <SelectItem key={m} value={m}>
              {t(`add.monitor_${m}`)}
            </SelectItem>
          ))}
          <SelectItem value="pick">{t("add.monitor_pick")}</SelectItem>
        </SelectContent>
      </Select>
      {choice === "pick" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {isLoading && (
            <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
          )}
          {(seasons ?? []).map((n) => {
            const on = current.has(n);
            return (
              <button
                type="button"
                key={n}
                aria-pressed={on}
                onClick={() => toggle(n)}
                className={cn(
                  focusRing,
                  "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                  on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                )}
              >
                {n === 0 ? t("add.specials") : t("add.seasonN", { n })}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** What the add call sends for a choice: a preset, or the picked seasons. */
export function monitorPayload(
  choice: MonitorChoice,
  picked: Set<number> | null,
  seasons: number[] | undefined,
): { monitor?: string; seasons?: number[] } {
  if (choice !== "pick") return { monitor: choice };
  const chosen = picked ?? new Set((seasons ?? []).filter((n) => n > 0));
  return { seasons: [...chosen].sort((a, b) => a - b) };
}
