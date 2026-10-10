import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { ImportCommand } from "../api/types";
import { useImportCandidates, useImportCommand, useManualImportAssign } from "../hooks/queries";
import { EmptyNote } from "./Blocks";
import { Sheet } from "./Sheet";
import { type Target, TargetPicker } from "./TargetPicker";

/** How the arr's import went, in its own words, followed until it finishes;
 * a toast says the same for whoever has already looked away. */
function ImportResult({ started }: { started: ImportCommand }) {
  const { t } = useTranslation();
  const { data } = useImportCommand(started.app, started.id);
  const command = data ?? started;
  const told = useRef(false);
  const summary = !command.done
    ? t("dl.importing")
    : command.ok
      ? command.imported != null
        ? t("dl.importedFiles", { count: command.imported })
        : (command.message ?? t("dl.importFinished"))
      : (command.message ?? t("dl.importFailed"));

  useEffect(() => {
    if (!command.done || told.current) return;
    told.current = true;
    if (command.ok) toast.success(summary);
    else toast.error(summary);
  }, [command.done, command.ok, summary]);

  return (
    <div
      role="status"
      className={cn(
        "mt-3 rounded-xl bg-muted/40 px-3 py-2.5 text-sm",
        command.done && !command.ok && "text-destructive",
      )}
    >
      {summary}
      {/* the arr's running commentary while it works ("Processing file 2 of 3") */}
      {!command.done && command.message && (
        <span className="mt-0.5 block text-xs text-muted-foreground">{command.message}</span>
      )}
    </div>
  );
}

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
  const assign = useManualImportAssign();
  const [started, setStarted] = useState<ImportCommand | null>(null);
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
            disabled={assign.isPending || picked.size === 0 || started != null}
            onClick={() =>
              // one request: hand-picked files carry their target, the rest
              // keep the arr's own match
              assign.mutate(
                {
                  app,
                  itemId,
                  files: [...picked].map((p) => ({ path: p, ...targets[p] })),
                },
                { onSuccess: setStarted },
              )
            }
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
      {started && <ImportResult started={started} />}
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
