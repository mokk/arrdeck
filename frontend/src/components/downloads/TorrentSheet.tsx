// Per-torrent detail: limits, queue position, category, tags, files.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, focusRing } from "@/lib/utils";
import { SERVICE_LABELS, formatBytes, formatEpoch } from "../../api/format";
import type { Torrent } from "../../api/types";

import { Sheet } from "../../components/Sheet";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  useTorrentAction,
  useTorrentCategory,
  useTorrentDetails,
  useTorrentFileToggle,
  useTorrentLimits,
  useTorrentRecheck,
  useTorrentPriority,
  useTorrentForceStart,
  useQbitTags,
  useTorrentTags,
} from "../../hooks/queries";

// how many rows each client returns per request; raised by "load more"

export function isPaused(t: Torrent) {
  return t.state === "paused" || t.state === "completed";
}

export function SheetButton({
  color,
  disabled,
  onClick,
  children,
}: {
  color?: "blue" | "red" | "muted";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={color === "muted" ? "ghost" : "secondary"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-2 h-11 w-full rounded-xl text-[0.95rem]",
        color === "blue" && "text-primary",
        color === "red" && "text-destructive",
        color === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}

export function TorrentDetailsSection({ torrent }: { torrent: Torrent }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTorrentDetails(torrent.client, torrent.id, true);
  const limits = useTorrentLimits();
  const category = useTorrentCategory();
  const recheck = useTorrentRecheck();
  const priority = useTorrentPriority();
  const forceStart = useTorrentForceStart();
  const tags = useTorrentTags();
  const { data: allTags } = useQbitTags(torrent.client === "qbittorrent");
  const fileToggle = useTorrentFileToggle();
  const [dl, setDl] = useState<string | null>(null);
  const [ul, setUl] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="mb-3 h-16 w-full rounded-xl" />;
  if (!data) return null;

  const dlVal = dl ?? String(data.dl_limit_kib ?? 0);
  const ulVal = ul ?? String(data.ul_limit_kib ?? 0);
  const limitsDirty =
    Number(dlVal) !== (data.dl_limit_kib ?? 0) || Number(ulVal) !== (data.ul_limit_kib ?? 0);

  return (
    <div className="mb-3">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div>
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.dlLimit")}</Label>
          <Input
            className="h-8 w-28"
            inputMode="numeric"
            value={dlVal}
            onChange={(e) => setDl(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div>
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.ulLimit")}</Label>
          <Input
            className="h-8 w-28"
            inputMode="numeric"
            value={ulVal}
            onChange={(e) => setUl(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!limitsDirty || limits.isPending}
          onClick={() =>
            limits.mutate({
              client: torrent.client,
              id: torrent.id,
              dl_kib: Number(dlVal) || 0,
              ul_kib: Number(ulVal) || 0,
            })
          }
        >
          {t("dl.apply")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate({ client: torrent.client, ids: [torrent.id] })}
        >
          {t("dl.recheck")}
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground">{t("dl.queue")}</Label>
        {(["top", "up", "down", "bottom"] as const).map((position) => (
          <Button
            key={position}
            size="sm"
            variant="secondary"
            disabled={priority.isPending}
            onClick={() =>
              priority.mutate({ client: torrent.client, ids: [torrent.id], position })
            }
          >
            {t(`dl.queue_${position}`)}
          </Button>
        ))}
        {torrent.client === "qbittorrent" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={forceStart.isPending}
            onClick={() => forceStart.mutate({ ids: [torrent.id], value: true })}
          >
            {t("dl.forceStart")}
          </Button>
        )}
      </div>
      {torrent.client === "qbittorrent" && (data.categories?.length ?? 0) > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("dl.category")}</Label>
          <Select
            value={data.category ?? "__none__"}
            disabled={category.isPending}
            onValueChange={(v) =>
              category.mutate({ id: torrent.id, category: v === "__none__" ? "" : v })
            }
          >
            <SelectTrigger size="sm" className="w-auto bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dl.noCategory")}</SelectItem>
              {(data.categories ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {torrent.client === "qbittorrent" && (allTags?.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("dl.tags")}</Label>
          {(allTags ?? []).map((tag) => {
            const on = (torrent.tags ?? []).includes(tag);
            return (
              <button
                key={tag}
                disabled={tags.isPending}
                className={cn(
                focusRing,
                  "rounded-full px-2.5 py-1 text-xs font-semibold active:opacity-60",
                  on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                )}
                onClick={() => tags.mutate({ ids: [torrent.id], tags: [tag], remove: on })}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("dl.files")} ({data.files.length})
      </div>
      <div className="max-h-40 overflow-y-auto rounded-xl bg-background/50 px-3 py-1">
        {data.files.map((f) => (
          <div
            key={f.name}
            className="flex items-center gap-2 border-t border-border py-1.5 text-xs first:border-t-0"
          >
            <button
              className={cn(
                focusRing,
                "flex size-4 shrink-0 items-center justify-center rounded border text-[9px] text-white",
                f.wanted ? "border-primary bg-primary" : "border-muted-foreground/50",
              )}
              disabled={fileToggle.isPending}
              onClick={() =>
                fileToggle.mutate({
                  client: torrent.client,
                  id: torrent.id,
                  index: f.index ?? 0,
                  wanted: !f.wanted,
                })
              }
            >
              {f.wanted ? "✓" : ""}
            </button>
            <span
              className={cn("min-w-0 flex-1 truncate", !f.wanted && "text-muted-foreground line-through")}
            >
              {f.name}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {formatBytes(f.size)} · {Math.round(f.progress * 100)}%
            </span>
          </div>
        ))}
      </div>
      {(data.trackers?.length ?? 0) > 0 && (
        <>
          <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("dl.trackers")}
          </div>
          <div className="max-h-32 overflow-y-auto rounded-xl bg-background/50 px-3 py-1">
            {(data.trackers ?? []).map((tr, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-t border-border py-1.5 text-xs first:border-t-0"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tr.ok ? "bg-success" : "bg-destructive",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{tr.host}</span>
                {!tr.ok && tr.message && (
                  <span className="shrink-0 text-destructive">{tr.message}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TorrentSheet({
  torrent,
  startAtDelete,
  onClose,
}: {
  torrent: Torrent;
  startAtDelete?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useTorrentAction();
  const [confirmingDelete, setConfirmingDelete] = useState(startAtDelete ?? false);
  const paused = isPaused(torrent);

  const run = (a: "pause" | "resume" | "delete", deleteData?: boolean) =>
    action.mutate(
      { client: torrent.client, action: a, ids: [torrent.id], deleteData },
      { onSettled: onClose },
    );

  return (
    <Sheet
      title={torrent.name}
      subtitle={`${SERVICE_LABELS[torrent.client]} · ${formatBytes(torrent.size)} · ${t("dl.ratio")} ${
        torrent.ratio?.toFixed(2) ?? "—"
      } · ${t("dl.added")} ${formatEpoch(torrent.added_on)}${torrent.tracker ? ` · ${torrent.tracker}` : ""}`}
      onClose={onClose}
    >
      {confirmingDelete ? (
        <>
          <SheetButton color="red" disabled={action.isPending} onClick={() => run("delete", true)}>
            {t("dl.deleteWithFiles")}
          </SheetButton>
          <SheetButton color="red" disabled={action.isPending} onClick={() => run("delete", false)}>
            {t("dl.deleteOnly")}
          </SheetButton>
          <SheetButton color="muted" onClick={() => setConfirmingDelete(false)}>
            {t("common.back")}
          </SheetButton>
        </>
      ) : (
        <>
          <TorrentDetailsSection torrent={torrent} />
          <SheetButton
            color="blue"
            disabled={action.isPending}
            onClick={() => run(paused ? "resume" : "pause")}
          >
            {paused ? t("common.resume") : t("common.pause")}
          </SheetButton>
          <SheetButton color="red" onClick={() => setConfirmingDelete(true)}>
            {t("dl.deleteEllipsis")}
          </SheetButton>
          <SheetButton color="muted" onClick={onClose}>
            {t("common.cancel")}
          </SheetButton>
        </>
      )}
    </Sheet>
  );
}
