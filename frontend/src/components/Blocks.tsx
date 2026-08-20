import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ServiceBlock } from "../api/types";

/** Renders a ServiceBlock: offline note (with stale fallback) or the content. */
export function BlockView<T>({
  block,
  children,
}: {
  block: ServiceBlock<T> | undefined;
  children: (data: T, stale: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  if (!block)
    return (
      <div className="px-4 py-3">
        <Skeleton className="mb-2 h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  if (!block.ok && block.data == null)
    return (
      <div className="px-4 py-2.5 text-sm text-destructive">
        {t("common.offline")} — {block.error}
      </div>
    );
  return (
    <>
      {!block.ok && block.stale_age_seconds != null && (
        <div className="px-4 pt-2 text-xs text-warning">
          {t("common.staleNote", { minutes: Math.round(block.stale_age_seconds / 60) })}
        </div>
      )}
      {children(block.data as T, !block.ok)}
    </>
  );
}

const STATE_COLORS: Record<string, string> = {
  downloading: "text-primary",
  fetched: "text-primary",
  seeding: "text-success",
  completed: "text-success",
  ok: "text-success",
  imported: "text-success",
  downloaded: "text-success",
  stalled: "text-warning",
  queued: "text-warning",
  warning: "text-warning",
  checking: "text-warning",
  wanted: "text-warning",
  error: "text-destructive",
  failed: "text-destructive",
  deleted: "text-destructive",
};

export function StateBadge({ state, raw }: { state: string; raw?: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="secondary"
      className={cn(
        "px-2 py-0 text-[0.68rem] font-semibold",
        !raw && "capitalize",
        STATE_COLORS[state] ?? "text-muted-foreground",
      )}
    >
      {raw ? state : t(`state.${state}`, { defaultValue: state })}
    </Badge>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.round(value * 100));
  return (
    <Progress
      value={pct}
      className={cn("mt-1.5 h-1", pct >= 100 && "[&>div]:bg-success")}
      title={`${pct}%`}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="mb-4">
      <TabsList className="w-full">
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} className="flex-1">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Shared list-row primitives */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mb-4 overflow-hidden rounded-2xl bg-card", className)}>{children}</div>;
}

export function Row({
  className,
  onClick,
  children,
}: {
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0",
        onClick && "cursor-pointer active:opacity-70",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mx-1 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 text-sm text-muted-foreground">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="px-4 py-2.5 text-sm text-destructive">{children}</div>;
}
