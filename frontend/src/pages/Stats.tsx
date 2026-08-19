import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDate } from "../api/format";
import type { StatsSample } from "../api/types";
import { Segmented } from "../components/Blocks";
import { useStatsHistory } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

function Chart({
  label,
  samples,
  pick,
  format,
}: {
  label: string;
  samples: StatsSample[];
  pick: (s: StatsSample) => number;
  format: (v: number) => string;
}) {
  const values = samples.map(pick);
  if (values.length < 2) return null;
  const w = 320;
  const h = 72;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`,
    )
    .join(" ");
  const first = samples[0];
  const last = samples[samples.length - 1];
  const delta = pick(last) - pick(first);

  return (
    <div className="mb-4 rounded-2xl bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">
          {formatDate(new Date(first.ts * 1000).toISOString())} →{" "}
          {formatDate(new Date(last.ts * 1000).toISOString())}
        </div>
      </div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xl font-bold">{format(pick(last))}</span>
        {delta !== 0 && (
          <span className={delta > 0 ? "text-xs text-success" : "text-xs text-destructive"}>
            {delta > 0 ? "+" : "−"}
            {format(Math.abs(delta))}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full text-primary">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [days, setDays] = usePersistentState<string>("stats.days", "30");
  const { data, isLoading } = useStatsHistory(Number(days));

  const count = (v: number) => String(Math.round(v));

  return (
    <>
      <div className="mb-4 mt-1 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("stats.title")}</h1>
      </div>
      <Segmented
        options={[
          { value: "30", label: t("stats.days30") },
          { value: "90", label: t("stats.days90") },
          { value: "365", label: t("stats.days365") },
        ]}
        value={days}
        onChange={setDays}
      />
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && data.length >= 2 ? (
        <>
          <Chart
            label={t("dash.librarySize")}
            samples={data}
            pick={(s) => s.library_bytes ?? 0}
            format={formatBytes}
          />
          <Chart
            label={t("dash.freeSpaceShort")}
            samples={data}
            pick={(s) => s.disk_free_bytes ?? 0}
            format={formatBytes}
          />
          <Chart label={t("dash.movies")} samples={data} pick={(s) => s.movies ?? 0} format={count} />
          <Chart
            label={t("dash.seriesCount")}
            samples={data}
            pick={(s) => s.series ?? 0}
            format={count}
          />
          <Chart
            label={t("stats.episodeFiles")}
            samples={data}
            pick={(s) => s.episode_files ?? 0}
            format={count}
          />
          <Chart
            label={t("stats.torrents")}
            samples={data}
            pick={(s) => (s.torrents_qbit ?? 0) + (s.torrents_tm ?? 0)}
            format={count}
          />
          <Chart
            label={t("dash.grabs")}
            samples={data}
            pick={(s) => s.indexer_grabs ?? 0}
            format={count}
          />
          <Chart
            label={t("stats.queries")}
            samples={data}
            pick={(s) => s.indexer_queries ?? 0}
            format={count}
          />
        </>
      ) : (
        !isLoading && (
          <div className="px-4 py-3 text-sm text-muted-foreground">{t("dash.nothingScheduled")}</div>
        )
      )}
    </>
  );
}
