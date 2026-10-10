import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { ImportCandidate, ImportCommand } from "../api/types";
import {
  useImportCandidates,
  useImportCommand,
  useImportOptions,
  useManualImportAssign,
} from "../hooks/queries";
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

type Override = { quality_id?: number; language_ids?: number[] };

/** Sets one file's quality and languages, for when the arr read the name
 * wrong. Starts from what the arr detected; "reset" goes back to it. */
function OverrideSheet({
  app,
  candidate,
  value,
  onChange,
  onClose,
}: {
  app: string;
  candidate: ImportCandidate;
  value: Override;
  onChange: (next: Override) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useImportOptions(app);
  const [q, setQ] = useState("");
  const quality = value.quality_id ?? candidate.quality_id ?? undefined;
  const languages = value.language_ids ?? candidate.language_ids ?? [];
  const toggleLanguage = (id: number) => {
    const next = languages.includes(id)
      ? languages.filter((x) => x !== id)
      : [...languages, id];
    // an empty pick means "keep what the arr detected", not "no language"
    onChange({ ...value, language_ids: next.length ? next : undefined });
  };
  const shown = (data?.languages ?? []).filter((l) =>
    l.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Sheet title={t("dl.qualityAndLanguage")} subtitle={candidate.name} onClose={onClose}>
      {!data && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {data && (
        <>
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.quality")}</Label>
          <Select
            value={quality != null ? String(quality) : undefined}
            onValueChange={(v) => onChange({ ...value, quality_id: Number(v) })}
          >
            <SelectTrigger size="sm" className="mb-3 w-full bg-secondary">
              <SelectValue placeholder={t("dl.qualityUnknown")} />
            </SelectTrigger>
            <SelectContent>
              {(data.qualities ?? []).map((x) => (
                <SelectItem key={x.id} value={String(x.id)}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(data.languages ?? []).length > 0 && (
            <>
              <Label className="mb-1 text-xs text-muted-foreground">{t("dl.languages")}</Label>
              <Input
                className="mb-2"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("dl.filterLanguages")}
              />
              <div className="mb-3 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {shown.map((l) => (
                  <Button
                    key={l.id}
                    size="sm"
                    variant={languages.includes(l.id) ? "default" : "secondary"}
                    className="rounded-full"
                    aria-pressed={languages.includes(l.id)}
                    onClick={() => toggleLanguage(l.id)}
                  >
                    {l.name}
                  </Button>
                ))}
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t("dl.done")}</Button>
            <Button variant="secondary" onClick={() => onChange({})}>
              {t("dl.useDetected")}
            </Button>
          </div>
        </>
      )}
    </Sheet>
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
  const { data: options } = useImportOptions(app);
  const assign = useManualImportAssign();
  const [started, setStarted] = useState<ImportCommand | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // files the arr couldn't place, pointed at a target by hand
  const [targets, setTargets] = useState<Record<string, Target>>({});
  // quality/language the user corrected; absent means the arr's detection
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<ImportCandidate | null>(null);

  const toggle = (path: string) => {
    const next = new Set(picked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setPicked(next);
  };

  /** The quality and languages a file will be imported as, marked when they
   * are the user's rather than the arr's. */
  const describe = (c: ImportCandidate) => {
    const o = overrides[c.path] ?? {};
    const quality =
      o.quality_id != null
        ? options?.qualities?.find((x) => x.id === o.quality_id)?.name
        : c.quality;
    const languages = o.language_ids
      ? o.language_ids.map((id) => options?.languages?.find((x) => x.id === id)?.name ?? id)
      : (c.languages ?? []);
    return {
      text: [quality ?? t("dl.qualityUnknown"), ...languages].join(" · "),
      changed: o.quality_id != null || o.language_ids != null,
    };
  };

  // a file is ready when the arr placed it or the user did, and it has a quality
  const ready = (c: ImportCandidate) =>
    (c.importable || targets[c.path] != null) &&
    (c.quality_id != null || overrides[c.path]?.quality_id != null);
  const importable = (data ?? []).filter(ready);

  return (
    <Sheet title={t("dl.manualImport")} onClose={onClose}>
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {data && data.length === 0 && <EmptyNote>{t("dl.noCandidates")}</EmptyNote>}
      {(data ?? []).map((c) => {
        const detail = describe(c);
        return (
          <div key={c.path} className="border-t border-border py-2 first:border-t-0">
            <button
              type="button"
              onClick={() =>
                c.importable || targets[c.path] ? toggle(c.path) : setChoosingFor(c.path)
              }
              className={cn(
                focusRing,
                "flex w-full items-start gap-2.5 text-left",
                !c.importable && !targets[c.path] && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[9px] text-white",
                  picked.has(c.path)
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/50",
                )}
              >
                {picked.has(c.path) ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[c.title, c.subtitle, formatBytes(c.size)].filter(Boolean).join(" · ")}
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
            {/* separate from the row's own button: one toggles the file, this
                corrects what the arr read from its name */}
            <button
              type="button"
              onClick={() => setEditing(c)}
              className={cn(
                focusRing,
                "ml-6.5 mt-1 rounded-md px-1.5 py-0.5 text-left text-xs",
                detail.changed ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {detail.text} · <span className="underline">{t("dl.change")}</span>
            </button>
          </div>
        );
      })}
      {(data ?? []).length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button
            disabled={assign.isPending || picked.size === 0 || started != null}
            onClick={() =>
              // one request: hand-picked files carry their target, the rest
              // keep the arr's own match; overrides ride along per file
              assign.mutate(
                {
                  app,
                  itemId,
                  files: [...picked].map((p) => ({
                    path: p,
                    movie_id: targets[p]?.movie_id,
                    series_id: targets[p]?.series_id,
                    episode_ids: targets[p]?.episode_ids,
                    ...overrides[p],
                  })),
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
      {editing && (
        <OverrideSheet
          app={app}
          candidate={editing}
          value={overrides[editing.path] ?? {}}
          onChange={(next) => setOverrides({ ...overrides, [editing.path]: next })}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  );
}
