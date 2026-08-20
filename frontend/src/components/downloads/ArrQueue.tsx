// The Radarr/Sonarr download queue shown above the torrent list.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { Card, Row, SectionTitle, StateBadge } from "../../components/Blocks";
import { ImportSheet } from "../ImportSheet";

import { useBlocklistRetry, useForceImport, useQueue, useQueueRemove } from "../../hooks/queries";


export function ArrQueue() {
  const { t } = useTranslation();
  const { data } = useQueue();
  const remove = useQueueRemove();
  const retry = useBlocklistRetry();
  const forceImport = useForceImport();
  const [importing, setImporting] = useState<{ app: string; id: number } | null>(null);
  const items = [...(data?.radarr?.data ?? []), ...(data?.sonarr?.data ?? [])];
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("dl.arrQueue")}</SectionTitle>
      <Card>
        {items.map((q) => (
          <Row key={`${q.app}-${q.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{q.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={q.app} />
                <StateBadge state={(q.errors ?? []).length ? "error" : q.status} />
                {q.errors?.[0] ? <span className="truncate">{q.errors[0]}</span> : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {q.tracked_state?.startsWith("import") && q.tracked_state !== "imported" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-primary"
                  disabled={forceImport.isPending}
                  onClick={() => forceImport.mutate({ app: q.app, id: q.id })}
                >
                  {t("dl.forceImport")}
                </Button>
              )}
              {(q.errors ?? []).length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-warning"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ app: q.app, id: q.id })}
                >
                  {t("dl.blocklistRetry")}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ app: q.app, id: q.id })}
              >
                {t("common.remove")}
              </Button>
              {/* the arr couldn't place the files itself — same entry point as
                  the dashboard queue card */}
              {(q.tracked_status === "warning" || q.tracked_status === "error") && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setImporting({ app: q.app, id: q.id })}
                >
                  {t("dl.manualImport")}
                </Button>
              )}
            </div>
          </Row>
        ))}
      </Card>
      {importing && (
        <ImportSheet
          app={importing.app}
          itemId={importing.id}
          onClose={() => setImporting(null)}
        />
      )}
    </div>
  );
}
