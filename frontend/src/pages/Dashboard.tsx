import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  SERVICE_LABELS,
  formatBytes,
  formatDate,
  formatDateTime,
  formatSpeed,
} from "../api/format";
import type { CalendarItem, HistoryItem, Torrent } from "../api/types";
import {
  BlockView,
  Card,
  EmptyNote,
  ErrorNote,
  ProgressBar,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import {
  useBlocklistRetry,
  useDiskSpace,
  useHealth,
  useMediaRequests,
  useVpn,
  useSubtitles,
  usePlaySessions,
  useSubtitleSearch,
  useRequestAction,
  useCalendar,
  useForceImport,
  useHistory,
  useIndexerStats,
  useQueue,
  useRecent,
  useSearch,
  useServices,
  useStatsHistory,
  useTorrents,
  useTorrentsSummary,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";
import { PosterGrid } from "../components/media";
import { ImportSheet } from "../components/ImportSheet";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useRegisterSearchbar } from "../components/subnav";
import type { SearchResult } from "../api/types";
import {
  HealthSection,
  NowPlayingSection,
  RequestsSection,
  StorageSection,
  SubtitlesSection,
  TrendsSection,
  VpnSection,
} from "../components/dashboard/cards";
import {
  CalendarSection,
  HistorySection,
  IndexerSection,
  QueueSection,
  RecentSection,
  TorrentSummary,
} from "../components/dashboard/activity";
import { GlobalSearch } from "../components/dashboard/search";


export default function Dashboard() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(input), 450);
    return () => clearTimeout(id);
  }, [input]);
  useRegisterSearchbar(t("search.global"), input, setInput, undefined, () => {
    setInput("");
    setQuery("");
  });

  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const hasArr = configured.has("radarr") || configured.has("sonarr");
  if (query.trim().length > 1) return <GlobalSearch query={query} />;
  return (
    <>
      {/* each card is isolated: a malformed payload from one service degrades
          that card instead of blanking the dashboard */}
      {[
        <NowPlayingSection key="now" configured={configured} />,
        <HealthSection key="health" configured={configured} />,
        <RequestsSection key="req" configured={configured} />,
        <RecentSection key="recent" />,
        <TorrentSummary key="torrents" configured={configured} />,
        hasArr ? <QueueSection key="queue" configured={configured} /> : null,
      ].map((card, i) => (
        <ErrorBoundary key={i}>{card}</ErrorBoundary>
      ))}
      <div className="lg:columns-2 lg:gap-5 [&>div]:break-inside-avoid">
        {[
          hasArr ? <CalendarSection key="cal" configured={configured} /> : null,
          <StorageSection key="storage" configured={configured} />,
          <VpnSection key="vpn" configured={configured} />,
          <SubtitlesSection key="subs" configured={configured} />,
          hasArr ? <HistorySection key="hist" configured={configured} /> : null,
          configured.has("prowlarr") ? <IndexerSection key="idx" /> : null,
          <TrendsSection key="trends" />,
        ].map((card, i) => (
          <ErrorBoundary key={i}>{card}</ErrorBoundary>
        ))}
      </div>
    </>
  );
}
