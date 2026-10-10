// The queue items, across the arrs, that wait on a person: blocked or failed
// imports and anything the arr flagged. Shown above the downloads and the
// queue, and nowhere at all while there is nothing to fix.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SERVICE_LABELS } from "../../api/format";
import type { QueueItem } from "../../api/types";
import { Card, Row, SectionTitle, StateBadge } from "../../components/Blocks";
import { useQueue } from "../../hooks/queries";
import { ImportSheet } from "../ImportSheet";

const APPS = ["radarr", "sonarr", "readarr"] as const;

/** The arr's own words for what is wrong, most specific first. */
function reasons(q: QueueItem): string[] {
  const messages = (q.status_messages ?? []).flatMap((m) => m.messages ?? []);
  return [...(q.error_message ? [q.error_message] : []), ...messages];
}

/** `focus` scrolls the list into view once it has loaded: the "needs manual
 * import" push lands here. `configured` keeps an arr that was never set up
 * (its /queue block is ok:false too) from reading as unreachable. */
export function NeedsAttention({
  configured,
  focus = false,
}: {
  configured: Set<string>;
  focus?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useQueue();
  const [importing, setImporting] = useState<{ app: string; id: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const items = APPS.flatMap((app) => data?.[app]?.data ?? []).filter((q) => q.needs_attention);
  const unreachable = APPS.filter(
    (app) => configured.has(app) && data?.[app] && !data[app]?.ok,
  );

  useEffect(() => {
    if (focus && items.length > 0) ref.current?.scrollIntoView({ block: "start" });
  }, [focus, items.length]);

  if (items.length === 0) return null;
  return (
    <div className="mb-6 scroll-mt-4" ref={ref} id="attention">
      <SectionTitle>
        {t("dl.needsAttention")}{" "}
        <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-warning">
          {items.length}
        </span>
      </SectionTitle>
      <Card>
        {items.map((q) => (
          <Row key={`${q.app}-${q.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{q.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={q.app} />
                <StateBadge state={q.tracked_status === "error" ? "error" : "warning"} />
                {q.tracked_state && <span className="truncate">{q.tracked_state}</span>}
              </div>
              {reasons(q).map((r) => (
                <div key={r} className="mt-0.5 text-xs text-warning">
                  {r}
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 text-primary"
              onClick={() => setImporting({ app: q.app, id: q.id })}
            >
              {t("dl.fix")}
            </Button>
          </Row>
        ))}
      </Card>
      {unreachable.length > 0 && (
        <div className="mx-1 -mt-2 text-xs text-muted-foreground">
          {t("dl.attentionUnavailable", {
            apps: unreachable.map((a) => SERVICE_LABELS[a]).join(", "),
          })}
        </div>
      )}
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
