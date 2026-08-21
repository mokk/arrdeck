import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DiagnosisFinding } from "../api/types";
import { useDiagnose } from "../hooks/queries";
import { EmptyNote, ErrorNote } from "./Blocks";
import { Sheet } from "./Sheet";

// Worst first, matching the order the endpoint sorts them into. The dot is the
// only colour cue, so it carries the level.
const LEVEL_DOT: Record<string, string> = {
  blocked: "bg-destructive",
  warning: "bg-warning",
  info: "bg-primary",
  ok: "bg-success",
};

function Finding({ finding }: { finding: DiagnosisFinding }) {
  const { t } = useTranslation();
  // A release date is often unknown for an announced film, so the dated and
  // undated sentences are separate keys rather than one with an empty gap.
  const key =
    finding.code === "not_yet_available" && finding.params?.date
      ? "diagnose.not_yet_available_dated"
      : `diagnose.${finding.code}`;
  return (
    <div className="flex gap-2.5 border-t border-border px-4 py-3 first:border-t-0">
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          LEVEL_DOT[finding.level] ?? "bg-muted-foreground",
        )}
      />
      <div className="min-w-0 text-sm leading-relaxed">
        {/* The endpoint returns codes rather than sentences so the wording can
            live in the locale files. An unknown code falls back to the code
            itself, which is better than an empty row. */}
        {t(key, { ...finding.params, defaultValue: finding.code })}
      </div>
    </div>
  );
}

/** Answers "why hasn't this arrived?" by reading the queue, the blocklist, the
 * item's own availability, the RSS schedule, delay profiles and indexer health in
 * one go — every one of which arrdeck already had, scattered. */
export function DiagnoseSheet({
  app,
  id,
  title,
  onClose,
}: {
  app: string;
  id: number;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, error, isLoading } = useDiagnose(app, id);
  const findings = data?.findings ?? [];
  return (
    <Sheet title={t("diagnose.title")} subtitle={title} onClose={onClose}>
      {isLoading && (
        <div className="px-4 py-3">
          <Skeleton className="mb-2 h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {data && findings.length === 0 && <EmptyNote>{t("diagnose.nothing_found")}</EmptyNote>}
      {findings.map((finding) => (
        <Finding key={`${finding.code}:${finding.level}`} finding={finding} />
      ))}
    </Sheet>
  );
}
