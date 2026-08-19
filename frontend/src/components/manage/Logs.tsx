import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SERVICE_LABELS } from "../../api/format";
import { Card, EmptyNote } from "../Blocks";
import { useLogs, useServices } from "../../hooks/queries";

const LEVELS = ["", "error", "warn", "info"];

/** The arrs' own logs. Debugging a failed grab used to mean opening Radarr,
 * then Sonarr, then Prowlarr in three tabs. */
export function Logs() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const available = (services ?? [])
    .filter((s) => s.configured && ["radarr", "sonarr", "prowlarr"].includes(s.service))
    .map((s) => s.service);
  const [app, setApp] = useState(available[0] ?? "radarr");
  const [level, setLevel] = useState("");
  const { data, isFetching } = useLogs(app, level, available.length > 0);

  if (available.length === 0) return <EmptyNote>{t("manage.notConfigured")}</EmptyNote>;

  const chip = (label: string, active: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
        active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {available.map((name) =>
          chip(SERVICE_LABELS[name] ?? name, app === name, () => setApp(name), name),
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LEVELS.map((l) =>
          chip(l === "" ? t("manage.allLevels") : l, level === l, () => setLevel(l), l || "all"),
        )}
      </div>
      {isFetching && !data && <Skeleton className="h-40 w-full rounded-2xl" />}
      {data && data.length === 0 && <EmptyNote>{t("manage.noLogs")}</EmptyNote>}
      {data && data.length > 0 && (
        <Card>
          <div className="max-h-[70vh] overflow-y-auto p-3">
            {data.map((entry, i) => (
              <div key={i} className="border-t border-border/60 py-1.5 first:border-t-0">
                <div className="flex items-baseline gap-2 text-[0.68rem]">
                  <span
                    className={cn(
                      "font-semibold uppercase",
                      entry.level === "error" || entry.level === "fatal"
                        ? "text-destructive"
                        : entry.level === "warn"
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.time ? new Date(entry.time).toLocaleTimeString() : ""}
                  </span>
                  <span className="truncate text-muted-foreground">{entry.logger}</span>
                </div>
                <div className="break-words font-mono text-xs">{entry.message}</div>
                {entry.exception && (
                  <div className="mt-0.5 break-words font-mono text-[0.65rem] text-destructive">
                    {entry.exception.split("\n")[0]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" disabled={isFetching} onClick={() => setLevel(level)}>
          {t("common.refresh")}
        </Button>
      </div>
    </>
  );
}
