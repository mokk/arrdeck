import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import { useArrReleases, useGrabArrRelease } from "../hooks/queries";
import { Sheet } from "./Sheet";

/** Interactive search: list actual releases from the arr's indexers, grab one. */
export function ReleasesSheet({
  app,
  params,
  title,
  onClose,
}: {
  app: "radarr" | "sonarr";
  params: { movieId?: number; seriesId?: number; season?: number; episodeId?: number };
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useArrReleases(app, params, true);
  const grab = useGrabArrRelease(app);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());

  return (
    <Sheet title={t("releases.interactive")} subtitle={title} onClose={onClose}>
      {isLoading && (
        <>
          <div className="mb-3 text-xs text-muted-foreground">{t("releases.searching")}</div>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full rounded-xl" />
          ))}
        </>
      )}
      {error && <div className="py-2 text-sm text-destructive">{(error as Error).message}</div>}
      {data?.map((r) => (
        <div
          key={r.guid}
          className={cn(
            "flex items-center gap-3 border-t border-border py-2.5 first:border-t-0",
            !r.approved && "opacity-50",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{r.title}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {r.quality ? `${r.quality} · ` : ""}
              {formatBytes(r.size)} · {r.seeders ?? "?"}/{r.leechers ?? "?"} · {r.indexer}
              {r.age_days != null ? ` · ${Math.round(r.age_days)}d` : ""}
            </div>
            {!r.approved && (r.rejections ?? []).length > 0 && (
              <div className="mt-0.5 truncate text-xs text-warning" title={(r.rejections ?? []).join("; ")}>
                {t("releases.rejected")}: {(r.rejections ?? [])[0]}
              </div>
            )}
          </div>
          <Button
            size="sm"
            disabled={grab.isPending || grabbed.has(r.guid)}
            onClick={() =>
              grab.mutate(
                { guid: r.guid, indexer_id: r.indexer_id },
                { onSuccess: () => setGrabbed(new Set(grabbed).add(r.guid)) },
              )
            }
          >
            {grabbed.has(r.guid) ? t("add.grabbed") : t("add.grab")}
          </Button>
        </div>
      ))}
      {data && data.length === 0 && (
        <div className="py-3 text-sm text-muted-foreground">{t("releases.none")}</div>
      )}
    </Sheet>
  );
}
