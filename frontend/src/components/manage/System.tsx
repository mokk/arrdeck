import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import {
  formatBytes,
  formatDateTime,
  formatEta,
  formatRelative,
  SERVICE_LABELS,
} from "../../api/format";
import type { ArrBackup, ScheduledTask } from "../../api/types";
import { useArrBackups, useServices, useTasks } from "../../hooks/queries";
import { BlockView, Card, EmptyNote, Row, SectionTitle } from "../Blocks";
import { Logs } from "./Logs";

const ARR_SERVICES = ["radarr", "sonarr", "prowlarr"];

function AppChip({ app }: { app: string }) {
  return (
    <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {SERVICE_LABELS[app] ?? app}
    </span>
  );
}

function ScopeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        focusRing,
        "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
        active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TaskRow({ task }: { task: ScheduledTask }) {
  const { t } = useTranslation();
  return (
    <Row>
      <AppChip app={task.app} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{task.label}</div>
        <div className="text-xs text-muted-foreground">
          {t("system.lastRan", { when: formatRelative(task.last_execution) })}
          {task.last_duration_seconds != null &&
            task.last_duration_seconds >= 1 &&
            ` · ${formatEta(Math.round(task.last_duration_seconds))}`}
        </div>
      </div>
      <div className={cn("shrink-0 text-right text-xs", task.overdue && "text-warning")}>
        {task.overdue ? (
          <span className="font-semibold">
            {t("system.overdueBy", {
              duration: formatEta(Math.round(task.overdue_by_seconds ?? 0)),
            })}
          </span>
        ) : (
          formatRelative(task.next_execution)
        )}
      </div>
    </Row>
  );
}

/** The arrs' schedulers. "Why hasn't anything been grabbed?" is usually
 * answered by "RSS sync last ran six hours ago", which lived only in each arr's
 * own System -> Tasks page until now. */
function TasksCard() {
  const { t } = useTranslation();
  const { data } = useTasks(true);
  const [scope, setScope] = useState<"notable" | "all">("notable");

  return (
    <>
      <SectionTitle>{t("system.tasks")}</SectionTitle>
      <Card>
        <BlockView block={data}>
          {(tasks) => {
            // Overdue tasks are the reason to look at this card, so they show
            // even when they aren't in the notable set.
            const shown =
              scope === "all" ? tasks : tasks.filter((task) => task.notable || task.overdue);
            const overdue = tasks.filter((task) => task.overdue).length;
            return (
              <>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    {overdue > 0 ? (
                      <span className="font-semibold text-warning">
                        {t("system.overdueCount", { count: overdue })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("system.allOnSchedule", { count: tasks.length })}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <ScopeChip
                      label={t("system.key")}
                      active={scope === "notable"}
                      onClick={() => setScope("notable")}
                    />
                    <ScopeChip
                      label={t("system.all")}
                      active={scope === "all"}
                      onClick={() => setScope("all")}
                    />
                  </div>
                </div>
                {shown.length === 0 ? (
                  <EmptyNote>{t("system.noTasks")}</EmptyNote>
                ) : (
                  shown.map((task) => <TaskRow key={`${task.app}:${task.name}`} task={task} />)
                )}
              </>
            );
          }}
        </BlockView>
      </Card>
    </>
  );
}

function BackupRow({ backup }: { backup: ArrBackup }) {
  const label = [backup.kind, formatBytes(backup.size_bytes)].filter(Boolean).join(" · ");
  const body = (
    <>
      <AppChip app={backup.app} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {backup.time ? formatDateTime(backup.time) : backup.name}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </>
  );
  // The arrs serve backups unauthenticated off their own root, so this is a
  // plain download the browser can handle; no proxying needed.
  if (!backup.url) return <Row>{body}</Row>;
  return (
    <a
      href={backup.url}
      download
      className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0 active:opacity-70"
    >
      {body}
    </a>
  );
}

/** The arrs keep their own backups on their own schedule — distinct from
 * arrdeck's backup, which only covers arrdeck's settings. */
function BackupsCard() {
  const { t } = useTranslation();
  const { data } = useArrBackups(true);
  return (
    <>
      <SectionTitle>{t("system.arrBackups")}</SectionTitle>
      <Card>
        <BlockView block={data}>
          {(backups) =>
            backups.length === 0 ? (
              <EmptyNote>{t("system.noBackups")}</EmptyNote>
            ) : (
              backups.map((backup) => (
                <BackupRow key={`${backup.app}:${backup.name}`} backup={backup} />
              ))
            )
          }
        </BlockView>
      </Card>
    </>
  );
}

export function SystemTab() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = (services ?? []).filter(
    (s) => s.configured && ARR_SERVICES.includes(s.service),
  );
  if (configured.length === 0) return <EmptyNote>{t("manage.notConfigured")}</EmptyNote>;
  return (
    <>
      <TasksCard />
      <BackupsCard />
      <SectionTitle>{t("manage.logs")}</SectionTitle>
      <Logs />
    </>
  );
}
