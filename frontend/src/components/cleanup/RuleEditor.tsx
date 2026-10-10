// The rule editor: kind, conditions, grace period, and a live preview of what
// the rule would take right now. The draft lives with the caller, so closing
// the sheet for the confirm dialog loses nothing. Saving never switches a
// rule on; that is its own confirmed step in the list.
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes } from "../../api/format";
import type { CleanupConditions, CleanupRuleDraft } from "../../api/types";
import { useCleanupKeep, useCleanupPreview, useTags } from "../../hooks/queries";
import { daysLeft, hasConditions, reasonText } from "../../lib/cleanupRules";
import { EmptyNote, ErrorNote } from "../Blocks";
import { BigButton } from "../media";
import { Sheet } from "../Sheet";

const PREVIEW_SHOWN = 30;
const PREVIEW_DELAY = 700;

type NumberKey = "watched_days" | "unwatched_days" | "min_size_gb" | "rating_below";
const NUMBERS: { key: NumberKey; start: number; step: number }[] = [
  { key: "watched_days", start: 180, step: 1 },
  { key: "unwatched_days", start: 365, step: 1 },
  { key: "min_size_gb", start: 50, step: 1 },
  { key: "rating_below", start: 5, step: 0.1 },
];
const HELD = ["kept", "requested", "recent"];

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function RuleEditor({
  draft,
  onChange,
  onSave,
  onClose,
  onDelete,
  saving,
}: {
  draft: CleanupRuleDraft;
  onChange: (draft: CleanupRuleDraft) => void;
  onSave: () => void;
  onClose: () => void;
  /** only for a saved rule */
  onDelete?: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const tags = useTags(draft.kind === "movie" ? "radarr" : "sonarr").data ?? [];
  const conditions = draft.conditions ?? {};
  const ready = hasConditions(conditions);
  const graceOk = (draft.grace_days ?? 14) >= 3;
  // only what decides the matches, so renaming a rule does not ask Plex again
  const probe = useMemo<CleanupRuleDraft | null>(
    () => (ready ? { kind: draft.kind, conditions: draft.conditions } : null),
    [ready, draft.kind, draft.conditions],
  );
  const preview = useCleanupPreview(useDebounced(probe, PREVIEW_DELAY));
  const keep = useCleanupKeep();

  const setConditions = (over: Partial<CleanupConditions>) =>
    onChange({ ...draft, conditions: { ...conditions, ...over } });
  const toggleTag = (field: "with_tags" | "without_tags", id: number) => {
    const current = conditions[field] ?? [];
    setConditions({
      [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    });
  };

  const matches = preview.data?.matches ?? [];
  const held = HELD.filter((k) => preview.data?.held?.[k]).map((k) =>
    t(`cleanupRules.held_${k}`, { n: preview.data?.held?.[k] }),
  );

  return (
    <Sheet
      title={draft.id ? t("cleanupRules.editRule") : t("cleanupRules.newRule")}
      onClose={onClose}
    >
      <div className="mb-3 flex gap-2">
        {(["movie", "series"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            // tag ids belong to one arr, so they do not survive a change of kind
            onClick={() =>
              onChange({
                ...draft,
                kind,
                conditions: { ...conditions, with_tags: [], without_tags: [] },
              })
            }
            className={cn(
              focusRing,
              "rounded-full px-3 py-1.5 text-xs font-semibold",
              draft.kind === kind
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {t(`cleanupRules.kind_${kind}`)}
          </button>
        ))}
      </div>
      <label htmlFor={`${ids}-name`} className="mb-3 block text-xs text-muted-foreground">
        {t("cleanupRules.name")}
        <Input
          id={`${ids}-name`}
          className="mt-1"
          value={draft.name ?? ""}
          maxLength={80}
          placeholder={t("cleanupRules.namePlaceholder")}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <div className="mb-1 text-xs text-muted-foreground">{t("cleanupRules.conditions")}</div>
      <div className="mb-3 flex flex-col gap-2 rounded-xl bg-background/50 px-3 py-2.5">
        {NUMBERS.map(({ key, start, step }) => {
          const value = conditions[key];
          return (
            <div key={key} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={value != null}
                onChange={(e) => setConditions({ [key]: e.target.checked ? start : null })}
                aria-label={t(`cleanupRules.cond_${key}`)}
                className="size-5 shrink-0 accent-primary"
              />
              <span className="flex-1">{t(`cleanupRules.cond_${key}`)}</span>
              <Input
                type="number"
                inputMode="decimal"
                className="w-20"
                min={step}
                step={step}
                disabled={value == null}
                value={value ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  // the server takes whole days
                  const v = key.endsWith("_days") ? Math.round(n) : n;
                  setConditions({ [key]: e.target.value === "" || !(v > 0) ? null : v });
                }}
              />
            </div>
          );
        })}
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={!!conditions.unmonitored}
            onChange={(e) => setConditions({ unmonitored: e.target.checked })}
            className="size-5 shrink-0 accent-primary"
          />
          {t("cleanupRules.cond_unmonitored")}
        </label>
        {tags.length > 0 &&
          (["without_tags", "with_tags"] as const).map((field) => (
            <div key={field} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">
                {t(
                  field === "with_tags" ? "cleanupRules.withTags" : "cleanupRules.withoutTags",
                )}
              </span>
              {tags.map((tag) => {
                const on = (conditions[field] ?? []).includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(field, tag.id)}
                    className={cn(
                      focusRing,
                      "rounded-full px-2.5 py-1 font-semibold",
                      on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          ))}
      </div>

      <label htmlFor={`${ids}-grace`} className="mb-1 flex items-center gap-3 text-sm">
        <span className="flex-1">{t("cleanupRules.grace")}</span>
        <Input
          id={`${ids}-grace`}
          type="number"
          inputMode="numeric"
          className="w-20"
          min={3}
          max={365}
          value={draft.grace_days ?? 14}
          onChange={(e) =>
            onChange({ ...draft, grace_days: Math.round(Number(e.target.value) || 0) })
          }
        />
      </label>
      <p className={cn("mb-3 text-xs", graceOk ? "text-muted-foreground" : "text-destructive")}>
        {t("cleanupRules.graceHint")}
      </p>

      <div className="mb-1 text-xs font-semibold text-muted-foreground">
        {t("cleanupRules.preview")}
      </div>
      <div className="mb-3 rounded-xl bg-background/50">
        {!ready && <EmptyNote>{t("cleanupRules.needsCondition")}</EmptyNote>}
        {ready && preview.isFetching && <EmptyNote>{t("cleanupRules.previewing")}</EmptyNote>}
        {ready && preview.error && <ErrorNote>{(preview.error as Error).message}</ErrorNote>}
        {ready && preview.data && !preview.isFetching && (
          <>
            <div className="px-3 pt-2.5 text-sm font-semibold">
              {matches.length
                ? t("cleanupRules.previewCount", {
                    count: matches.length,
                    size: formatBytes(preview.data.total_size),
                  })
                : t("cleanupRules.previewNone")}
            </div>
            {held.length > 0 && (
              <div className="px-3 text-xs text-muted-foreground">
                {t("cleanupRules.held", { list: held.join(" · ") })}
              </div>
            )}
            <ul className="py-1.5">
              {matches.slice(0, PREVIEW_SHOWN).map((m) => (
                <li
                  key={`${m.kind}:${m.id}`}
                  className="flex items-center gap-2 px-3 py-1 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        ...(m.reasons ?? []).map((r) => reasonText(t, r)),
                        m.leave_at != null &&
                          (daysLeft(m.leave_at) > 0
                            ? t("cleanupRules.leavesIn", { count: daysLeft(m.leave_at) })
                            : t("cleanupRules.leavesNext")),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold">{formatBytes(m.size)}</span>
                  <button
                    type="button"
                    disabled={keep.isPending}
                    aria-label={t("cleanupRules.keepTitle", { title: m.title })}
                    onClick={() => keep.mutate(m)}
                    className={cn(
                      focusRing,
                      "shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary",
                    )}
                  >
                    {t("cleanupRules.keep")}
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > PREVIEW_SHOWN && (
              <div className="px-3 pb-2.5 text-xs text-muted-foreground">
                {t("cleanupRules.previewMore", { n: matches.length - PREVIEW_SHOWN })}
              </div>
            )}
          </>
        )}
      </div>

      <BigButton color="blue" disabled={!ready || !graceOk || saving} onClick={onSave}>
        {t("cleanupRules.saveRule")}
      </BigButton>
      {onDelete && (
        <BigButton color="red" onClick={onDelete}>
          {t("cleanupRules.deleteRule")}
        </BigButton>
      )}
      <BigButton color="muted" onClick={onClose}>
        {t("common.cancel")}
      </BigButton>
    </Sheet>
  );
}
