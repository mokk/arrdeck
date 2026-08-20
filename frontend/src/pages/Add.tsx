import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clickable, cn } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { Release, SearchResult } from "../api/types";
import { Card, EmptyNote, ErrorNote, Row, SectionTitle } from "../components/Blocks";
import { MediaSheet, PosterGrid } from "../components/media";
import { Sheet } from "../components/Sheet";
import { useRegisterSearchbar, useRegisterSubnav } from "../components/subnav";
import {
  useCollectionDetail,
  useCollections,
  useDiscover,
  useGrabRelease,
  useSearch,
  useServices,
  useToggleCollection,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type Tab = "movies" | "series" | "releases" | "collections";

function ReleaseList({ releases }: { releases: Release[] }) {
  const { t } = useTranslation();
  const grab = useGrabRelease();
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  return (
    <Card>
      {releases.map((r) => (
        <Row key={r.guid}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{r.title}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {r.indexer} · {formatBytes(r.size)} ·{" "}
              {t("add.seeders", { count: r.seeders ?? 0 })}
              {r.age_days != null
                ? ` · ${t("add.daysOld", { count: Math.round(r.age_days) })}`
                : ""}
            </div>
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
        </Row>
      ))}
      {releases.length === 0 && <EmptyNote>{t("add.noReleases")}</EmptyNote>}
    </Card>
  );
}

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

function CollectionsList({ filter }: { filter: string }) {
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
          {c.poster ? (
            <img
              src={c.poster}
              alt=""
              loading="lazy"
              className="w-9 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
            />
          ) : (
            <div className="w-9 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("collections.movies", {
                have: (c.movie_count ?? 0) - (c.missing_count ?? 0),
                total: c.movie_count ?? 0,
              })}
            </div>
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

const TAB_SERVICE: Record<Tab, string> = {
  movies: "radarr",
  series: "sonarr",
  releases: "prowlarr",
  collections: "radarr",
};

export default function Add() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service),
  );
  const tabs = (["movies", "series", "collections", "releases"] as Tab[]).filter((tab) =>
    configured.has(TAB_SERVICE[tab] as never),
  );

  const [storedTab, setTab] = usePersistentState<Tab>("add.tab", "movies");
  const tab = tabs.includes(storedTab) ? storedTab : tabs[0];
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const searching = query.trim().length > 1;
  const canDiscover = configured.has("overseerr" as never);
  const search = useSearch(
    tab === "collections" ? "movies" : (tab ?? "movies"),
    tab === "collections" ? "" : query,
  );
  const discover = useDiscover(
    tab === "series" ? "series" : "movies",
    tab != null && tab !== "releases" && tab !== "collections" && !searching && canDiscover,
  );
  const _collections = useCollections(tab === "collections");

  const onTab = (t: Tab) => {
    setTab(t);
    setInput("");
    setQuery("");
  };

  // live search: debounce typing into the query (submit still works instantly);
  // raw releases stay submit-only (indexer fan-out is expensive)
  useEffect(() => {
    if (tab === "releases" || tab === "collections") return;
    const id = setTimeout(() => setQuery(input), 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, tab]);

  useRegisterSubnav(
    tabs.map((tb) => ({
      value: tb,
      label: tb === "collections" ? t("collections.title") : t(`add.${tb}`),
    })),
    tab ?? "movies",
    (v) => onTab(v as Tab),
  );

  const searchPlaceholder =
    tab === "releases"
      ? t("add.searchReleases")
      : tab === "series"
        ? t("add.searchSeries")
        : tab === "collections"
          ? t("dl.filterByName")
          : t("add.searchMovies");

  useRegisterSearchbar(
    searchPlaceholder,
    input,
    setInput,
    () => setQuery(input),
    () => {
      setInput("");
      setQuery("");
    },
  );

  if (services && tabs.length === 0) {
    return <EmptyNote>{t("add.noServices")}</EmptyNote>;
  }

  return (
    <>
      {search.error && searching && <ErrorNote>{(search.error as Error).message}</ErrorNote>}

      {tab === "collections" ? (
        <CollectionsList filter={input} />
      ) : tab === "releases" ? (
        searching && search.data ? (
          <ReleaseList releases={search.data as Release[]} />
        ) : (
          <EmptyNote>{t("add.searchProwlarr")}</EmptyNote>
        )
      ) : searching ? (
        search.data ? (
          <PosterGrid results={search.data as SearchResult[]} />
        ) : null
      ) : canDiscover ? (
        <>
          <SectionTitle>
            {tab === "series" ? t("add.popularSeries") : t("add.popularMovies")}
          </SectionTitle>
          {discover.error && <ErrorNote>{(discover.error as Error).message}</ErrorNote>}
          {discover.data ? (
            <PosterGrid results={discover.data} />
          ) : (
            !discover.error && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-3.5">
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} className="w-full rounded-xl [aspect-ratio:2/3]" />
                ))}
              </div>
            )
          )}
        </>
      ) : (
        <EmptyNote>{t("add.configureOverseerr")}</EmptyNote>
      )}
    </>
  );
}
