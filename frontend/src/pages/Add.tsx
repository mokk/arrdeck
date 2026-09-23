import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "../api/format";
import type { Release, SearchResult } from "../api/types";
import { Card, EmptyNote, ErrorNote, Row, SectionTitle } from "../components/Blocks";
import { DetailHeader } from "../components/detail";
import { CollectionsList } from "../components/library/Collections";
import { PosterGrid } from "../components/media";
import { useRegisterSearchbar } from "../components/subnav";
import {
  useCollections,
  useDiscover,
  useGrabRelease,
  useSearch,
  useServices,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type Tab = "movies" | "series" | "books" | "releases" | "collections";

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

const TAB_SERVICE: Record<Tab, string> = {
  movies: "radarr",
  series: "sonarr",
  books: "readarr",
  releases: "prowlarr",
  collections: "radarr",
};

export default function Add() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service),
  );
  const tabs = (["movies", "series", "books", "collections", "releases"] as Tab[]).filter(
    (tab) => configured.has(TAB_SERVICE[tab] as never),
  );

  const [storedTab, setTab] = usePersistentState<Tab>("add.tab", "movies");
  // the library "+" buttons arrive with ?tab=movies|series so Add opens on
  // the library the user was looking at
  // The library "+" opens Add for one kind (?tab=movies|series|books), like
  // the app's fixed Add sheet; there is no bar to switch kinds here.
  const [params] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab =
    requested && tabs.includes(requested)
      ? requested
      : tabs.includes(storedTab)
        ? storedTab
        : tabs[0];
  useEffect(() => {
    if (tab && tab !== storedTab) setTab(tab);
  }, [tab, storedTab, setTab]);
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
    tab != null &&
      tab !== "releases" &&
      tab !== "collections" &&
      tab !== "books" &&
      !searching &&
      canDiscover,
  );
  const _collections = useCollections(tab === "collections");

  // live search: debounce typing into the query (submit still works instantly);
  // raw releases stay submit-only (indexer fan-out is expensive)
  useEffect(() => {
    if (tab === "releases" || tab === "collections") return;
    const id = setTimeout(() => setQuery(input), 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, tab]);

  const searchPlaceholder =
    tab === "releases"
      ? t("add.searchReleases")
      : tab === "series"
        ? t("add.searchSeries")
        : tab === "books"
          ? t("add.searchBooks")
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

  const heading =
    tab === "series"
      ? t("add.addShow")
      : tab === "books"
        ? t("add.addBook")
        : tab === "movies"
          ? t("add.addMovie")
          : t("add.title");

  return (
    <>
      <DetailHeader title={heading} />
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
      ) : tab === "books" ? (
        // Overseerr knows nothing about books, so there is no popular list
        <EmptyNote>{t("add.searchBooksHint")}</EmptyNote>
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
