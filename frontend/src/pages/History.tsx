import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "../api/format";
import type { HistoryItem } from "../api/types";
import { Card, EmptyNote, Row, StateBadge } from "../components/Blocks";
import { useHistoryPage } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

const TYPE_CHIPS = ["fetched", "imported", "failed", "deleted"];

export default function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [appFilter, setAppFilter] = usePersistentState<string>("history.app", "all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { data, isFetching } = useHistoryPage(page);

  useEffect(() => {
    if (data) {
      setItems((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const shown = items.filter(
    (h) =>
      (appFilter === "all" || h.app === appFilter) &&
      (typeFilter === "all" || (h.events ?? []).some((e) => e.type === typeFilter)),
  );

  const chip = (label: string, value: string) => (
    <Button
      key={value}
      size="sm"
      variant={appFilter === value ? "default" : "secondary"}
      className="shrink-0 rounded-full"
      onClick={() => setAppFilter(value)}
    >
      {label}
    </Button>
  );

  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {chip(t("dl.all", { count: items.length }), "all")}
        {chip("Radarr", "radarr")}
        {chip("Sonarr", "sonarr")}
        {TYPE_CHIPS.map((type) => (
          <Button
            key={type}
            size="sm"
            variant={typeFilter === type ? "default" : "secondary"}
            className="shrink-0 rounded-full capitalize"
            onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
          >
            {t(`state.${type}`)}
          </Button>
        ))}
      </div>
      <Card>
        {items.length === 0 && isFetching && (
          <div className="p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="mb-2 h-10 w-full" />
            ))}
          </div>
        )}
        {shown.map((h, i) => (
          <Row
            key={`${h.app}-${h.date}-${i}`}
            onClick={
              h.movie_id
                ? () => navigate(`/movie/${h.movie_id}`)
                : h.series_id
                  ? () => navigate(`/series/${h.series_id}`)
                  : undefined
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{h.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                <StateBadge state={h.app} />
                {(h.events ?? []).map((e) => (
                  <span key={e.type} title={formatDateTime(e.date)}>
                    <StateBadge state={e.type} />
                  </span>
                ))}
                {h.quality && <span className="text-muted-foreground">{h.quality}</span>}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(h.date)}
            </div>
          </Row>
        ))}
        {items.length > 0 && shown.length === 0 && <EmptyNote>{t("dl.noMatch")}</EmptyNote>}
      </Card>
      {data?.has_more && (
        <div className="mb-6 mt-2 text-center">
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
    </>
  );
}
