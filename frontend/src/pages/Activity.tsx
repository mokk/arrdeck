// Everything about what is downloading, in one tab: the import history first,
// then the torrent clients and the arrs' queues. What arrived since the last
// visit is marked NEW in both History and the torrent list, against one cutoff
// taken when the tab opens: opening either moves the mark, and the other must
// still show what was new when the visit began. Which segments exist depends on what is
// configured; a bare download client still gets its torrent list.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ArrQueue } from "../components/downloads/ArrQueue";
import { useRegisterSubnav } from "../components/subnav";
import { useServices } from "../hooks/queries";
import { getLastSeen } from "../lib/lastSeen";
import Downloads from "./Downloads";
import HistoryPage from "./History";

type Segment = "history" | "downloads" | "queue";

export default function Activity() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [since] = useState(getLastSeen);
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const hasClient = configured.has("qbittorrent") || configured.has("transmission");
  const hasArr = ["radarr", "sonarr", "readarr"].some((s) => configured.has(s));
  const segments: Segment[] = [
    ...(hasArr ? (["history"] as Segment[]) : []),
    ...(hasClient ? (["downloads"] as Segment[]) : []),
    ...(hasArr ? (["queue"] as Segment[]) : []),
  ];
  const requested = params.get("tab") as Segment | null;
  const segment = requested && segments.includes(requested) ? requested : segments[0];

  useRegisterSubnav(
    segments.map((s) => ({ value: s, label: t(`activity.${s}`) })),
    segment ?? "downloads",
    (v) => setParams(v === segments[0] ? {} : { tab: v }, { replace: true }),
    () => setParams({}, { replace: true }),
  );

  if (segment === "downloads") return <Downloads since={since} />;
  if (segment === "queue") return <ArrQueue />;
  if (segment === "history") return <HistoryPage since={since} />;
  return null;
}
