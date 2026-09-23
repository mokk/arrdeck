import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, SERVICE_LABELS } from "../../api/format";
import type { ActivityEvent } from "../../api/types";
import { useActivitySince } from "../../hooks/queries";
import { getLastSeen, markSeen } from "../../lib/lastSeen";
import { Card, EmptyNote, Row, StateBadge } from "../Blocks";

/** Imports, failures, grabs and finished torrents since the last visit. The
 * cutoff is captured once on mount, so the list stays put while the badge
 * resets the moment the data is in. */
export function SinceLastLook() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [since] = useState(getLastSeen);
  const { data, isLoading, error } = useActivitySince(since);

  useEffect(() => {
    if (data?.now) markSeen(data.now);
  }, [data?.now]);

  const open = (e: ActivityEvent) => {
    if (e.movie_id) navigate(`/movie/${e.movie_id}`);
    else if (e.series_id) navigate(`/series/${e.series_id}`);
    else if (e.book_id) navigate(`/book/${e.book_id}`);
  };

  return (
    <>
      <p className="mb-3 px-1 text-xs text-muted-foreground">
        {t("activity.sinceLabel", { time: formatDateTime(since) })}
      </p>
      {error && <EmptyNote>{(error as Error).message}</EmptyNote>}
      <Card>
        {isLoading && (
          <div className="p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-2 h-10 w-full" />
            ))}
          </div>
        )}
        {data && (data.items ?? []).length === 0 && (
          <EmptyNote>{t("activity.nothingNew")}</EmptyNote>
        )}
        {(data?.items ?? []).map((e, i) => (
          <Row
            key={`${e.app}-${e.date}-${i}`}
            onClick={e.movie_id || e.series_id || e.book_id ? () => open(e) : undefined}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{e.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={e.kind} />
                <StateBadge state={SERVICE_LABELS[e.app] ?? e.app} raw />
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(e.date)}
            </div>
          </Row>
        ))}
      </Card>
    </>
  );
}
