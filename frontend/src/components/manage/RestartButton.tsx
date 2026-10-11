// Restart (or start) one compose project through the host helper. Always asks
// first, as a destructive action: a restart interrupts whatever the service is
// doing, and restarting arrdeck takes this app away for a moment.
import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { RestartableProject } from "../../api/types";
import { useServiceAction } from "../../hooks/queries";
import { useConfirm } from "../Confirm";

export function RestartButton({
  project,
  label,
  compact = false,
}: {
  project: RestartableProject;
  label: string;
  /** an icon only, for the status strip */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const act = useServiceAction();
  // a project that is not fully running gets `up -d`, which is also what
  // brings back containers that exited after a reboot
  const action = project.running ? "restart" : "up";
  const verb = action === "restart" ? t("system.restart") : t("system.start");

  const run = async () => {
    const ok = await confirm({
      always: true,
      action: verb,
      subject: project.is_self ? `${label} — ${t("system.restartSelfWarning")}` : label,
      destructive: true,
    });
    if (!ok) return;
    act.mutate(
      { name: project.name, action },
      {
        // failures are toasted by the app-wide mutation handler
        onSuccess: (result) => {
          if (result.pending) toast.message(t("system.restartingSelf"));
          else
            toast.success(
              t(action === "restart" ? "system.restarted" : "system.started", { name: label }),
            );
        },
      },
    );
  };

  if (compact)
    return (
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`${verb} ${label}`}
        title={`${verb} ${label}`}
        disabled={act.isPending}
        onClick={run}
      >
        <RotateCw className={act.isPending ? "animate-spin" : undefined} />
      </Button>
    );
  return (
    <Button size="sm" variant="secondary" disabled={act.isPending} onClick={run}>
      {act.isPending ? t("system.restarting") : verb}
    </Button>
  );
}
