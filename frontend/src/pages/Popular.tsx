import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import {
  BlockView,
  Card,
  EmptyNote,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import { useRegisterSubnav } from "../components/subnav";
import { useGrabRelease, usePopular } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

// Torznab has no "trending", so this is the newest releases ranked by the
// indexer's own grab count. 24h is what a single 100-result page can honestly
// cover once the query is split per sub-category.
const WINDOWS = [24];

function hoursSince(published: string | null | undefined): number | null {
  if (!published) return null;
  return (Date.now() - new Date(published).getTime()) / 3_600_000;
}

export default function PopularPage() {
  const { t } = useTranslation();
  const [hours] = usePersistentState<number>("popular.hours", WINDOWS[0]);
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const { data, isFetching } = usePopular(hours);
  const grab = useGrabRelease();

  useRegisterSubnav(
    [
      { value: "all", label: t("popular.all") },
      { value: "movie", label: t("popular.movies") },
      { value: "tv", label: t("popular.tv") },
    ],
    kind,
    (v) => setKind(v as "all" | "movie" | "tv"),
  );

  return (
    <>
      {isFetching && !data && (
        <>
          {/* the fan-out queries every category on every indexer and takes
              the better part of a minute; say so rather than look stuck */}
          <p className="mb-3 px-1 text-xs text-muted-foreground">{t("popular.loading")}</p>
          <Skeleton className="mb-3 h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </>
      )}
      <BlockView block={data}>
        {(snapshot) => (
          <>
            {(snapshot.indexers ?? []).map((source) => {
              const releases = (source.releases ?? []).filter(
                (r) => kind === "all" || r.kind === kind,
              );
              return (
                <div key={source.indexer_id} className="mb-6">
                  <SectionTitle>
                    {source.indexer}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {t("popular.scanned", {
                        count: source.scanned,
                        hours: snapshot.hours ?? hours,
                      })}
                    </span>
                  </SectionTitle>
                  <Card>
                    {releases.length === 0 && <EmptyNote>{t("popular.none")}</EmptyNote>}
                    {releases.map((release, i) => (
                      <Row key={release.guid || release.title}>
                        <span
                          className={cn(
                            "w-5 shrink-0 text-center text-sm font-bold",
                            i < 3 ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{release.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <StateBadge state={release.kind === "tv" ? "sonarr" : "radarr"} />
                            {/* grabs is the ranking signal, so lead with it */}
                            <span className="font-semibold text-foreground">
                              {t("popular.grabs", { count: release.grabs ?? 0 })}
                            </span>
                            {`${release.seeders ?? 0} ↑`}
                            {formatBytes(release.size)}
                            {release.category}
                            {(() => {
                              const h = hoursSince(release.published);
                              if (h == null) return null;
                              return h < 1
                                ? t("popular.justNow")
                                : t("popular.hoursAgo", { hours: Math.round(h) });
                            })()}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="shrink-0"
                          disabled={grab.isPending || !release.guid}
                          onClick={() =>
                            grab.mutate({
                              guid: release.guid ?? "",
                              indexer_id: release.indexer_id ?? 0,
                            })
                          }
                        >
                          {t("popular.grab")}
                        </Button>
                      </Row>
                    ))}
                  </Card>
                </div>
              );
            })}
            <p className="px-1 text-xs text-muted-foreground">
              {snapshot.generated_at
                ? `${t("popular.generated", {
                    when: new Date(snapshot.generated_at * 1000).toLocaleTimeString(),
                  })} · `
                : ""}
              {t("popular.hint")}
            </p>
          </>
        )}
      </BlockView>
    </>
  );
}
