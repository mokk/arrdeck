import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "../api/format";
import type { WantedItem } from "../api/types";
import { Card, EmptyNote, Row } from "../components/Blocks";
import { ReleasesSheet } from "../components/ReleasesSheet";
import { useRegisterSubnav } from "../components/subnav";
import {
  useEpisodeSearch,
  useServices,
  useTriggerSearch,
  useWanted,
  useWantedSearchAll,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

type Kind = "missing" | "cutoff";

function WantedList({ app, kind }: { app: "radarr" | "sonarr"; kind: Kind }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WantedItem[]>([]);
  const { data, isFetching } = useWanted(app, kind, page);
  const movieSearch = useTriggerSearch();
  const episodeSearch = useEpisodeSearch();
  const searchAll = useWantedSearchAll();
  const [releaseTarget, setReleaseTarget] = useState<WantedItem | null>(null);

  useEffect(() => {
    setPage(1);
    setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, kind]);

  useEffect(() => {
    if (data) setItems((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("wanted.count", { count: data?.total ?? 0 })}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full"
          disabled={searchAll.isPending || (data?.total ?? 0) === 0}
          onClick={() => searchAll.mutate({ app, kind })}
        >
          {t("wanted.searchAll")}
        </Button>
      </div>
      <Card>
        {items.length === 0 && isFetching && (
          <div className="p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-2 h-12 w-full" />
            ))}
          </div>
        )}
        {items.length === 0 && !isFetching && <EmptyNote>{t("wanted.empty")}</EmptyNote>}
        {items.map((w) => (
          <Row key={`${w.app}-${w.id}`}>
            {w.poster ? (
              <img
                src={w.poster}
                alt=""
                loading="lazy"
                className="w-9 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
              />
            ) : (
              <div className="w-9 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{w.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {w.subtitle ?? ""} {w.air_date ? `· ${formatDate(w.air_date)}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={movieSearch.isPending || episodeSearch.isPending}
                onClick={() =>
                  w.app === "radarr"
                    ? movieSearch.mutate({ app: "radarr", id: w.id })
                    : episodeSearch.mutate([w.id])
                }
              >
                {t("common.search")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("releases.interactive")}
            title={t("releases.interactive")}
                onClick={() => setReleaseTarget(w)}
              >
                <ChevronRight />
              </Button>
            </div>
          </Row>
        ))}
      </Card>
      {data?.has_more && (
        <div className="mb-4 mt-2 text-center">
          <Button
            variant="secondary"
            className="rounded-full"
            disabled={isFetching}
            onClick={() => setPage(page + 1)}
          >
            {isFetching ? t("history.loadingMore") : t("history.loadMore")}
          </Button>
        </div>
      )}
      {releaseTarget && (
        <ReleasesSheet
          app={releaseTarget.app}
          params={
            releaseTarget.app === "radarr"
              ? { movieId: releaseTarget.library_id }
              : { seriesId: releaseTarget.library_id, episodeId: releaseTarget.id }
          }
          title={`${releaseTarget.title} ${releaseTarget.subtitle ?? ""}`}
          onClose={() => setReleaseTarget(null)}
        />
      )}
    </>
  );
}

export default function WantedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const apps = (["radarr", "sonarr"] as const).filter((a) => configured.has(a));
  const [kind, setKind] = usePersistentState<Kind>("wanted.kind", "missing");
  const [storedApp, setApp] = usePersistentState<"radarr" | "sonarr">("wanted.app", "radarr");
  const app = apps.includes(storedApp) ? storedApp : apps[0];

  useRegisterSubnav(
    [
      { value: "missing", label: t("wanted.missing") },
      { value: "cutoff", label: t("wanted.cutoff") },
    ],
    kind,
    (v) => setKind(v as Kind),
  );

  if (!app) return <EmptyNote>{t("add.noServices")}</EmptyNote>;

  return (
    <>
      <div className="mb-4 mt-1 flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("wanted.title")}</h1>
        <div className="ml-auto flex gap-1.5">
          {apps.length > 1 &&
            apps.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={app === a ? "default" : "secondary"}
                className="rounded-full"
                onClick={() => setApp(a)}
              >
                {a === "radarr" ? "Radarr" : "Sonarr"}
              </Button>
            ))}
        </div>
      </div>
      <WantedList app={app} kind={kind} />
    </>
  );
}
