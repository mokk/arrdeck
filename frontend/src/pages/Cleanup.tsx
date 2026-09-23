// The cleanup assistant: what could go to free disk space, and why. Four
// lists, a running "reclaim" total for what is ticked, and one delete that
// always asks first — whatever the ask-before setting says.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes, formatWhen } from "../api/format";
import type { CleanupItem } from "../api/types";
import { Card, EmptyNote, ErrorNote } from "../components/Blocks";
import { DetailHeader } from "../components/detail";
import { Cover } from "../components/library/Cover";
import { BigButton } from "../components/media";
import { Sheet } from "../components/Sheet";
import { useCleanup, useCleanupDelete } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type List = "watched" | "never_watched" | "largest" | "unmonitored";
const LISTS: List[] = ["watched", "never_watched", "largest", "unmonitored"];
const WATCHED_DAYS = [30, 90, 180, 365];

const keyOf = (i: CleanupItem) => `${i.kind}:${i.id}`;

export default function CleanupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [list, setList] = usePersistentState<List>("cleanup.list", "watched");
  const [days, setDays] = usePersistentState("cleanup.watchedDays", 30);
  const { data, error, isLoading } = useCleanup(days);
  const remove = useCleanupDelete();
  const [picked, setPicked] = useState<Map<string, CleanupItem>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [exclude, setExclude] = useState(true);

  const rows = data?.[list] ?? [];
  const total = (items: CleanupItem[]) => items.reduce((sum, i) => sum + (i.size ?? 0), 0);
  const chosen = [...picked.values()];
  const toggle = (item: CleanupItem) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(keyOf(item))) next.delete(keyOf(item));
      else next.set(keyOf(item), item);
      return next;
    });
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(keyOf(r)));
  const pickAll = () => {
    const next = new Map(picked);
    for (const r of rows) {
      if (allPicked) next.delete(keyOf(r));
      else next.set(keyOf(r), r);
    }
    setPicked(next);
  };

  const reason = (item: CleanupItem) => {
    if (list === "watched" && item.last_viewed_at)
      return t("cleanup.watchedOn", {
        when: formatWhen(new Date(item.last_viewed_at * 1000).toISOString()),
      });
    if (list === "never_watched" && item.added)
      return t("cleanup.addedWhen", { when: formatWhen(item.added) });
    return item.kind === "movie" ? t("cleanup.movie") : t("cleanup.show");
  };

  return (
    <>
      <DetailHeader title={t("cleanup.title")} />
      <p className="mb-4 text-sm text-muted-foreground">{t("cleanup.intro")}</p>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {LISTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={list === l}
            onClick={() => setList(l)}
            className={cn(
              focusRing,
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
              list === l
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {t(`cleanup.list_${l}`)}
            {data && ` · ${formatBytes(total(data[l] ?? []))}`}
          </button>
        ))}
      </div>
      {list === "watched" && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          {t("cleanup.olderThan")}
          {WATCHED_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                focusRing,
                "rounded-md px-2 py-0.5",
                days === d ? "bg-secondary font-semibold text-foreground" : "",
              )}
            >
              {t("cleanup.days", { count: d })}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="h-40 w-full rounded-2xl" />}
      {data && !data.plex && (list === "watched" || list === "never_watched") && (
        <EmptyNote>{t("cleanup.needsPlex")}</EmptyNote>
      )}
      {data &&
        rows.length === 0 &&
        (data.plex || list === "largest" || list === "unmonitored") && (
          <EmptyNote>{t("cleanup.nothing")}</EmptyNote>
        )}
      {rows.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              {t("cleanup.count", { count: rows.length, size: formatBytes(total(rows)) })}
            </span>
            <button
              type="button"
              className={cn(focusRing, "rounded font-semibold text-primary")}
              onClick={pickAll}
            >
              {allPicked ? t("cleanup.pickNone") : t("cleanup.pickAll")}
            </button>
          </div>
          <Card>
            {rows.map((item) => {
              const on = picked.has(keyOf(item));
              return (
                <div
                  key={keyOf(item)}
                  className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(item)}
                    aria-label={t("cleanup.pick", { title: item.title })}
                    className="size-5 shrink-0 accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/${item.kind === "movie" ? "movie" : "series"}/${item.id}`)
                    }
                    className={cn(
                      focusRing,
                      "flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70",
                    )}
                  >
                    <div className="w-9 shrink-0">
                      <Cover src={item.poster} title={item.title ?? ""} compact />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {item.title}{" "}
                        <span className="text-muted-foreground">{item.year ?? ""}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {reason(item)}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">
                      {formatBytes(item.size)}
                    </span>
                  </button>
                </div>
              );
            })}
          </Card>
        </>
      )}
      {chosen.length > 0 && (
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] mt-4">
          <Button
            className="h-12 w-full rounded-full text-base shadow-xl"
            variant="destructive"
            onClick={() => setConfirming(true)}
          >
            {t("cleanup.reclaim", { size: formatBytes(total(chosen)), count: chosen.length })}
          </Button>
        </div>
      )}
      {confirming && (
        <Sheet
          title={t("cleanup.confirmTitle", { count: chosen.length })}
          subtitle={t("cleanup.confirmBody", { size: formatBytes(total(chosen)) })}
          onClose={() => setConfirming(false)}
        >
          <label className="mb-3 flex items-center gap-3 rounded-xl bg-background/50 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={exclude}
              onChange={(e) => setExclude(e.target.checked)}
              className="size-5 accent-primary"
            />
            {t("cleanup.exclude")}
          </label>
          <BigButton
            color="red"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { items: chosen, exclude },
                {
                  onSuccess: () => {
                    setPicked(new Map());
                    setConfirming(false);
                  },
                },
              )
            }
          >
            {t("cleanup.deleteNow", { size: formatBytes(total(chosen)) })}
          </BigButton>
          <BigButton color="muted" onClick={() => setConfirming(false)}>
            {t("common.cancel")}
          </BigButton>
        </Sheet>
      )}
    </>
  );
}
