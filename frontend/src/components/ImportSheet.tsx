import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes } from "../api/format";
import { useImportCandidates, useManualImport, useManualImportAssign } from "../hooks/queries";
import { EmptyNote } from "./Blocks";
import { Sheet } from "./Sheet";
import { type Target, TargetPicker } from "./TargetPicker";

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
  const assign = useManualImportAssign();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // files the arr couldn't place, pointed at a target by hand
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [choosingFor, setChoosingFor] = useState<string | null>(null);

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
          type="button"
          key={c.path}
          onClick={() =>
            c.importable || targets[c.path] ? toggle(c.path) : setChoosingFor(c.path)
          }
          className={cn(
            focusRing,
            "flex w-full items-start gap-2.5 border-t border-border py-2 text-left first:border-t-0",
            !c.importable && !targets[c.path] && "opacity-60",
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
              {[c.title, c.subtitle, c.quality, formatBytes(c.size)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {(c.rejections?.length ?? 0) > 0 && (
              <span className="mt-0.5 block text-xs text-warning">
                {c.rejections!.join(" · ")}
              </span>
            )}
            {targets[c.path] ? (
              <span className="mt-0.5 block text-xs text-primary">
                → {targets[c.path].label}
              </span>
            ) : (
              !c.importable && (
                <span className="mt-0.5 block text-xs text-primary">
                  {t("dl.chooseTarget")}
                </span>
              )
            )}
          </span>
        </button>
      ))}
      {(data ?? []).length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button
            disabled={run.isPending || assign.isPending || picked.size === 0}
            onClick={() => {
              const chosen = [...picked];
              const auto = chosen.filter((p) => !targets[p]);
              const manual = chosen.filter((p) => targets[p]);
              const done = () => {
                toast.success(t("dl.importStarted"));
                onClose();
              };
              // hand-assigned files go through the endpoint that takes explicit
              // targets; the rest keep using the arr's own mapping
              if (manual.length === 0) {
                run.mutate({ app, itemId, paths: auto }, { onSuccess: done });
                return;
              }
              assign.mutate(
                {
                  app,
                  itemId,
                  files: manual.map((p) => ({ path: p, ...targets[p] })),
                },
                {
                  onSuccess: () => {
                    if (auto.length)
                      run.mutate({ app, itemId, paths: auto }, { onSuccess: done });
                    else done();
                  },
                },
              );
            }}
          >
            {t("dl.importSelected", { count: picked.size })}
          </Button>
          {importable.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setPicked(new Set(importable.map((c) => c.path)))}
            >
              {t("dl.selectAll")}
            </Button>
          )}
        </div>
      )}
      {choosingFor && (
        <TargetPicker
          app={app}
          onClose={() => setChoosingFor(null)}
          onPick={(target) => {
            setTargets({ ...targets, [choosingFor]: target });
            setPicked(new Set([...picked, choosingFor]));
            setChoosingFor(null);
          }}
        />
      )}
    </Sheet>
  );
}
