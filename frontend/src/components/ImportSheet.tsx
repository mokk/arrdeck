import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import { EmptyNote } from "./Blocks";
import { Sheet } from "./Sheet";
import { useImportCandidates, useManualImport } from "../hooks/queries";

/** Everything the arr found in a stuck download, including the files it
 * refused, so a rejection can be read and overridden rather than guessed at. */
export function ImportSheet({
  app,
  itemId,
  onClose,
}: {
  app: string;
  itemId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useImportCandidates(app, itemId);
  const run = useManualImport();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    const next = new Set(picked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPicked(next);
  };

  const importable = (data ?? []).filter((c) => c.importable);

  return (
    <Sheet title={t("dl.manualImport")} onClose={onClose}>
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {data && data.length === 0 && <EmptyNote>{t("dl.noCandidates")}</EmptyNote>}
      {(data ?? []).map((c) => (
        <button
          key={c.path}
          disabled={!c.importable}
          onClick={() => toggle(c.path)}
          className={cn(
            "flex w-full items-start gap-2.5 border-t border-border py-2 text-left first:border-t-0",
            !c.importable && "opacity-60",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[9px] text-white",
              picked.has(c.path) ? "border-primary bg-primary" : "border-muted-foreground/50",
            )}
          >
            {picked.has(c.path) ? "✓" : ""}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{c.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {[c.title, c.subtitle, c.quality, formatBytes(c.size)].filter(Boolean).join(" · ")}
            </span>
            {(c.rejections?.length ?? 0) > 0 && (
              <span className="mt-0.5 block text-xs text-warning">
                {c.rejections!.join(" · ")}
              </span>
            )}
          </span>
        </button>
      ))}
      {importable.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button
            disabled={run.isPending || picked.size === 0}
            onClick={() =>
              run.mutate(
                { app, itemId, paths: [...picked] },
                {
                  onSuccess: () => {
                    toast.success(t("dl.importStarted"));
                    onClose();
                  },
                },
              )
            }
          >
            {t("dl.importSelected", { count: picked.size })}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPicked(new Set(importable.map((c) => c.path)))}
          >
            {t("dl.selectAll")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
