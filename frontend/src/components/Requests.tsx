// Overseerr requests where the library shows the title: a badge on the card
// until it arrives, and on the detail page who asked, with approve and decline
// while it waits.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { RequestState } from "../api/types";
import { useRequestAction, useRequestMap, useServices } from "../hooks/queries";

type Ids = { kind: "movie" | "tv"; tmdb_id?: number | null; tvdb_id?: number | null };

export function requestFor(
  map: Record<string, RequestState> | null | undefined,
  { kind, tmdb_id, tvdb_id }: Ids,
): RequestState | undefined {
  if (!map) return undefined;
  if (kind === "tv" && tvdb_id && map[`tv:tvdb:${tvdb_id}`]) return map[`tv:tvdb:${tvdb_id}`];
  return tmdb_id ? map[`${kind}:tmdb:${tmdb_id}`] : undefined;
}

/** The request map, fetched only when Overseerr is configured. */
export function useRequests() {
  const { data: services } = useServices();
  const enabled = (services ?? []).some((s) => s.service === "overseerr" && s.configured);
  return useRequestMap(enabled).data?.data;
}

export function RequestBadge({ request }: { request: RequestState | undefined }) {
  const { t } = useTranslation();
  if (!request) return null;
  const pending = request.status === 1;
  return (
    <span
      className={
        pending
          ? "rounded-md bg-warning px-1.5 py-0.5 text-[10px] font-bold text-black"
          : "rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"
      }
      title={t("requests.by", { user: request.requested_by })}
    >
      {pending ? t("requests.pending") : t("requests.requested")}
    </span>
  );
}

export function RequestBanner({ ids }: { ids: Ids }) {
  const { t } = useTranslation();
  const request = requestFor(useRequests(), ids);
  const act = useRequestAction();
  if (!request) return null;
  const pending = request.status === 1;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-card px-4 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">
          {pending ? t("requests.waiting") : t("requests.approvedWaiting")}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t("requests.by", { user: request.requested_by || "?" })}
        </div>
      </div>
      {pending && (
        <>
          <Button
            size="sm"
            disabled={act.isPending}
            onClick={() => act.mutate({ id: request.request_id, action: "approve" })}
          >
            {t("requests.approve")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={act.isPending}
            onClick={() => act.mutate({ id: request.request_id, action: "decline" })}
          >
            {t("requests.decline")}
          </Button>
        </>
      )}
    </div>
  );
}
