// Cleanup rules on the Cleanup page: the master switch, the rules, what is
// leaving soon, the keep list and the run log. Everything that switches
// something on or can delete goes through the confirm dialog first.
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes, formatEpoch } from "../../api/format";
import type {
  CleanupKept,
  CleanupLogTitle,
  CleanupRule,
  CleanupRuleDraft,
  CleanupRun,
  CleanupRules as Rules,
} from "../../api/types";
import {
  useCleanupKeep,
  useCleanupKept,
  useCleanupLeaving,
  useCleanupLog,
  useCleanupRules,
  useCleanupRun,
  useCleanupUnkeep,
  useSaveCleanupRules,
} from "../../hooks/queries";
import { daysLeft, newRule, reasonText } from "../../lib/cleanupRules";
import { Card, EmptyNote, ErrorNote, SectionTitle } from "../Blocks";
import { useConfirm } from "../Confirm";
import { Cover } from "../library/Cover";
import { Sheet } from "../Sheet";
import { RuleEditor } from "./RuleEditor";

const MAX_DELETIONS = [5, 10, 20, 50];

function Pill({
  on,
  label,
  onClick,
  disabled,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        focusRing,
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
        on
          ? "bg-destructive text-destructive-foreground"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {on ? t("cleanupRules.on") : t("cleanupRules.off")}
    </button>
  );
}

export function CleanupRules() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data, error } = useCleanupRules();
  const save = useSaveCleanupRules();
  const run = useCleanupRun();
  const [editing, setEditing] = useState<CleanupRuleDraft | null>(null);
  const [result, setResult] = useState<CleanupRun | null>(null);

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  if (!data) return <Skeleton className="h-40 w-full rounded-2xl" />;

  const { settings, rules } = data;
  const persist = (next: Partial<Rules>) => save.mutate({ settings, rules, ...next });
  const nameOf = (rule: CleanupRuleDraft) => rule.name || summary(rule);
  const summary = (rule: CleanupRuleDraft) => {
    const c = rule.conditions ?? {};
    const parts = [
      c.watched_days != null && t("cleanupRules.summary_watched", { n: c.watched_days }),
      c.unwatched_days != null && t("cleanupRules.summary_unwatched", { n: c.unwatched_days }),
      c.min_size_gb != null && t("cleanupRules.summary_size", { n: c.min_size_gb }),
      c.rating_below != null && t("cleanupRules.summary_rating", { n: c.rating_below }),
      c.unmonitored && t("cleanupRules.summary_unmonitored"),
      ((c.with_tags?.length ?? 0) > 0 || (c.without_tags?.length ?? 0) > 0) &&
        t("cleanupRules.summary_tags"),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("cleanupRules.summary_none");
  };

  const toggleSwitch = async () => {
    if (
      !settings.enabled &&
      !(await confirm({
        always: true,
        action: t("cleanupRules.turnOn"),
        subject: t("cleanupRules.turnOnBody"),
        destructive: true,
      }))
    )
      return;
    persist({ settings: { ...settings, enabled: !settings.enabled } });
  };

  const toggleRule = async (rule: CleanupRule) => {
    if (
      !rule.enabled &&
      !(await confirm({
        always: true,
        action: t("cleanupRules.enableRule"),
        subject: t("cleanupRules.enableRuleBody", {
          name: nameOf(rule),
          days: rule.grace_days,
        }),
        destructive: true,
      }))
    )
      return;
    persist({
      rules: rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
    });
  };

  const removeRule = async (rule: CleanupRule) => {
    // the sheet closes for the question and comes back if it is declined
    setEditing(null);
    if (
      await confirm({
        always: true,
        action: t("cleanupRules.deleteRule"),
        subject: t("cleanupRules.deleteRuleBody", { name: nameOf(rule) }),
        destructive: true,
      })
    )
      persist({ rules: rules.filter((r) => r.id !== rule.id) });
    else setEditing(rule);
  };

  const saveDraft = async () => {
    const draft = editing;
    if (!draft) return;
    setEditing(null);
    if (
      draft.enabled &&
      !(await confirm({
        always: true,
        action: t("cleanupRules.saveRule"),
        subject: t("cleanupRules.saveEnabledBody", { name: nameOf(draft) }),
        destructive: true,
      }))
    ) {
      setEditing(draft);
      return;
    }
    const next = draft.id
      ? rules.map((r) => (r.id === draft.id ? (draft as CleanupRule) : r))
      : [...rules, draft as CleanupRule];
    save.mutate({ settings, rules: next }, { onError: () => setEditing(draft) });
  };

  // a higher limit lets a run delete more, so it asks like switching on does
  const setLimit = async (n: number) => {
    if (
      n > (settings.max_deletions ?? 10) &&
      !(await confirm({
        always: true,
        action: t("cleanupRules.raiseLimit", { n }),
        subject: t("cleanupRules.raiseLimitBody"),
        destructive: true,
      }))
    )
      return;
    persist({ settings: { ...settings, max_deletions: n } });
  };

  const runNow = async () => {
    if (
      await confirm({
        always: true,
        action: t("cleanupRules.runNow"),
        subject: t("cleanupRules.runNowBody"),
        destructive: true,
      })
    )
      run.mutate(false, { onSuccess: setResult });
  };

  return (
    <>
      <Card className="px-4 py-3">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex-1 font-semibold">{t("cleanupRules.switchTitle")}</div>
          <Pill
            on={settings.enabled ?? false}
            label={t("cleanupRules.switchTitle")}
            disabled={save.isPending}
            onClick={toggleSwitch}
          />
        </div>
        <p className="mb-2 text-xs text-muted-foreground">{t("cleanupRules.switchExplain")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t("cleanupRules.brakes")}</p>
        <p className="mb-3 text-xs font-semibold">
          {settings.enabled ? t("cleanupRules.onNote") : t("cleanupRules.offNote")}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("cleanupRules.maxDeletions")}
          {MAX_DELETIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.max_deletions === n}
              onClick={() => setLimit(n)}
              className={cn(
                focusRing,
                "rounded-md px-2 py-0.5",
                settings.max_deletions === n
                  ? "bg-secondary font-semibold text-foreground"
                  : "",
              )}
            >
              {t("cleanupRules.perRun", { n })}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={run.isPending}
            onClick={() => run.mutate(true, { onSuccess: setResult })}
          >
            {t("cleanupRules.dryRun")}
          </Button>
          {settings.enabled && (
            <Button size="sm" variant="destructive" disabled={run.isPending} onClick={runNow}>
              {t("cleanupRules.runNow")}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("cleanupRules.dryRunHint")}</p>
      </Card>

      <SectionTitle>{t("cleanupRules.rules")}</SectionTitle>
      <Card>
        {rules.length === 0 && <EmptyNote>{t("cleanupRules.noRules")}</EmptyNote>}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
          >
            <button
              type="button"
              onClick={() => setEditing(rule)}
              className={cn(focusRing, "min-w-0 flex-1 text-left active:opacity-70")}
            >
              <div className="truncate text-sm font-medium">
                {nameOf(rule)}{" "}
                <span className="text-muted-foreground">
                  · {t(`cleanupRules.kind_${rule.kind}`)}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {summary(rule)} · {t("cleanupRules.summary_grace", { n: rule.grace_days })}
              </div>
            </button>
            <Pill
              on={rule.enabled}
              label={t("cleanupRules.toggleRule", { name: nameOf(rule) })}
              disabled={save.isPending}
              onClick={() => toggleRule(rule)}
            />
          </div>
        ))}
        <div className="border-t border-border px-4 py-2.5 first:border-t-0">
          <Button size="sm" variant="ghost" onClick={() => setEditing(newRule())}>
            {t("cleanupRules.addRule")}
          </Button>
        </div>
      </Card>

      <Leaving />
      <Kept />
      <RunLog />

      {editing && (
        <RuleEditor
          draft={editing}
          onChange={setEditing}
          onSave={saveDraft}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => removeRule(editing as CleanupRule) : undefined}
          saving={save.isPending}
        />
      )}
      {result && (
        <Sheet
          title={result.dry_run ? t("cleanupRules.resultDry") : t("cleanupRules.result")}
          subtitle={formatEpoch(result.ts)}
          onClose={() => setResult(null)}
        >
          <RunSummary run={result} open />
        </Sheet>
      )}
    </>
  );
}

function Leaving() {
  const { t } = useTranslation();
  const { data } = useCleanupLeaving();
  const keep = useCleanupKeep();
  return (
    <>
      <SectionTitle>{t("cleanupRules.leaving")}</SectionTitle>
      <Card>
        {data?.length === 0 && <EmptyNote>{t("cleanupRules.leavingNone")}</EmptyNote>}
        {data?.map((item) => {
          const days = daysLeft(item.leave_at);
          return (
            <div
              key={`${item.kind}:${item.id}`}
              className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
            >
              <div className="w-9 shrink-0">
                <Cover src={item.poster} title={item.title ?? ""} compact />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {item.title} <span className="text-muted-foreground">{item.year ?? ""}</span>
                </div>
                <div className="truncate text-xs font-semibold text-destructive">
                  {days > 0
                    ? t("cleanupRules.leavesIn", { count: days })
                    : t("cleanupRules.leavesNext")}
                  {" · "}
                  {formatBytes(item.size)}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[item.rule_name, ...(item.reasons ?? []).map((r) => reasonText(t, r))]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={keep.isPending}
                aria-label={t("cleanupRules.keepTitle", { title: item.title })}
                onClick={() => keep.mutate(item)}
              >
                {t("cleanupRules.keep")}
              </Button>
            </div>
          );
        })}
      </Card>
    </>
  );
}

function Kept() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data } = useCleanupKept();
  const unkeep = useCleanupUnkeep();
  const unkeepOne = async (item: CleanupKept) => {
    const subject = item.title || `#${item.id}`;
    if (
      await confirm({
        always: true,
        action: t("cleanupRules.unkeepAction"),
        subject,
        destructive: true,
      })
    )
      unkeep.mutate(item);
  };
  return (
    <>
      <SectionTitle>{t("cleanupRules.kept")}</SectionTitle>
      <Card>
        <p className="px-4 pt-2.5 text-xs text-muted-foreground">
          {t("cleanupRules.keptIntro")}
        </p>
        {data?.length === 0 && <EmptyNote>{t("cleanupRules.keptNone")}</EmptyNote>}
        {data?.map((item) => (
          <div key={`${item.kind}:${item.id}`} className="flex items-center gap-3 px-4 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">
              {item.title || `#${item.id}`}{" "}
              <span className="text-muted-foreground">{item.year ?? ""}</span>
            </span>
            <button
              type="button"
              aria-label={t("cleanupRules.unkeep", { title: item.title || `#${item.id}` })}
              disabled={unkeep.isPending}
              onClick={() => unkeepOne(item)}
              className={cn(focusRing, "rounded px-2 text-muted-foreground")}
            >
              ✕
            </button>
          </div>
        ))}
        {(data?.length ?? 0) > 0 && (
          <div className="px-4 py-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={unkeep.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    always: true,
                    action: t("cleanupRules.clearKept"),
                    subject: t("cleanupRules.clearKeptBody"),
                    destructive: true,
                  })
                )
                  unkeep.mutate(undefined);
              }}
            >
              {t("cleanupRules.clearKept")}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

function RunLog() {
  const { t } = useTranslation();
  const { data } = useCleanupLog();
  return (
    <>
      <SectionTitle>{t("cleanupRules.log")}</SectionTitle>
      <Card>
        {data?.length === 0 && <EmptyNote>{t("cleanupRules.logNone")}</EmptyNote>}
        {data?.map((entry) => (
          <div
            key={`${entry.ts}:${entry.trigger}`}
            className="border-t border-border px-4 py-2 first:border-t-0"
          >
            <div className="text-xs font-semibold">
              {formatEpoch(entry.ts)} ·{" "}
              {t(`cleanupRules.trigger_${entry.trigger}`, entry.trigger)}
            </div>
            <RunSummary run={entry} />
          </div>
        ))}
      </Card>
    </>
  );
}

function RunSummary({ run, open = false }: { run: CleanupRun; open?: boolean }) {
  const { t } = useTranslation();
  if (run.skipped)
    return (
      <div className="text-xs text-destructive">
        {t(`cleanupRules.skipped_${run.skipped}`, run.skipped)}
        {(run.errors ?? []).map((e) => (
          <div key={e}>{e}</div>
        ))}
      </div>
    );
  const groups: [string, CleanupLogTitle[]][] = [
    ["deleted", run.deleted ?? []],
    ["marked", run.marked ?? []],
    ["released", run.released ?? []],
    ["keptInRun", run.kept ?? []],
  ];
  const shown = groups.filter(([, items]) => items.length > 0);
  if (!shown.length && !run.deferred && !(run.errors ?? []).length)
    return <div className="text-xs text-muted-foreground">{t("cleanupRules.nothingDone")}</div>;
  return (
    <div className="text-xs">
      {shown.map(([key, items]) => (
        <Group key={key} title={t(`cleanupRules.${key}`, { n: items.length })} open={open}>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="truncate text-muted-foreground">
              {item.title} {item.year ?? ""} · {formatBytes(item.size)}
              {item.reason && ` · ${t(`cleanupRules.released_${item.reason}`, item.reason)}`}
            </li>
          ))}
        </Group>
      ))}
      {!!run.deferred && (
        <div className="text-muted-foreground">
          {t("cleanupRules.deferred", { n: run.deferred })}
        </div>
      )}
      {(run.errors ?? []).length > 0 && (
        <Group title={t("cleanupRules.errors")} open={open}>
          {(run.errors ?? []).map((e) => (
            <li key={e} className="text-destructive">
              {e}
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="mt-1">
      <summary className={cn(focusRing, "cursor-pointer rounded font-semibold")}>
        {title}
      </summary>
      <ul className="mt-0.5 pl-3">{children}</ul>
    </details>
  );
}
