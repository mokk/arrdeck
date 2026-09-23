// Radarr's collections: how complete each is, and a sheet to fill the gaps.
// Shown from the Add page and as the Movies tab's Collections view.
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clickable, cn } from "@/lib/utils";
import type { SearchResult } from "../../api/types";
import { useCollectionDetail, useCollections, useToggleCollection } from "../../hooks/queries";
import { Card, EmptyNote, ErrorNote, Row } from "../Blocks";
import { MediaSheet } from "../media";
import { Sheet } from "../Sheet";
import { Completion } from "./Completion";
import { Cover } from "./Cover";

function CollectionSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = useCollectionDetail(id);
  const toggle = useToggleCollection();
  const [selected, setSelected] = useState<SearchResult | null>(null);

  if (selected) {
    return <MediaSheet result={selected} onClose={() => setSelected(null)} />;
  }

  const have = (data?.movies ?? []).filter((m) => m.in_library).length;

  return (
    <Sheet
      title={data?.title ?? "…"}
      subtitle={
        data
          ? `${t("collections.movies", { have, total: data.movies?.length ?? 0 })}${
              data.overview ? ` — ${data.overview.slice(0, 140)}` : ""
            }`
          : undefined
      }
      onClose={onClose}
    >
      {isLoading &&
        [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-12 w-full rounded-xl" />)}
      {data && (
        <div className="mb-3">
          <Button
            variant="secondary"
            size="sm"
            className={cn(data.monitored && "text-primary")}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ id: data.id, monitored: !data.monitored })}
          >
            {data.monitored ? t("collections.unmonitor") : t("collections.monitor")}
          </Button>
        </div>
      )}
      {(data?.movies ?? []).map((m) => (
        <div
          key={m.remote_id}
          className="flex cursor-pointer items-center gap-3 border-t border-border py-2 first:border-t-0 active:opacity-70"
          {...clickable(() => setSelected(m))}
        >
          {m.poster ? (
            <img
              src={m.poster}
              alt=""
              loading="lazy"
              className="w-9 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
            />
          ) : (
            <div className="w-9 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
            </div>
            <div className="mt-0.5 text-xs">
              {m.in_library ? (
                <span className={m.has_file ? "text-success" : "text-primary"}>
                  {m.has_file ? t("add.downloadedBadge") : t("add.monitoredBadge")}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("add.notInLibrary")}</span>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </div>
      ))}
    </Sheet>
  );
}

export function CollectionsList({ filter }: { filter: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useCollections(true);
  const toggle = useToggleCollection();
  const shown = (data ?? []).filter((c) =>
    (c.title ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <Card>
      {isLoading && (
        <div className="p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full" />
          ))}
        </div>
      )}
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {shown.map((c) => (
        <Row key={c.id} onClick={() => setOpenId(c.id)}>
          <div className="w-9 shrink-0">
            <Cover src={c.poster} title={c.title ?? ""} compact />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("collections.movies", {
                have: (c.movie_count ?? 0) - (c.missing_count ?? 0),
                total: c.movie_count ?? 0,
              })}
            </div>
            <Completion
              have={(c.movie_count ?? 0) - (c.missing_count ?? 0)}
              total={c.movie_count ?? 0}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={cn("shrink-0", c.monitored && "text-primary")}
            disabled={toggle.isPending}
            onClick={(e) => {
              e.stopPropagation();
              toggle.mutate({ id: c.id, monitored: !c.monitored });
            }}
          >
            {c.monitored ? t("collections.unmonitor") : t("collections.monitor")}
          </Button>
        </Row>
      ))}
      {data && shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      {openId != null && <CollectionSheet id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
