// Global search across movies, series and torrents.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { SERVICE_LABELS } from "../../api/format";
import type { SearchResult } from "../../api/types";
import { Card, EmptyNote, Row, SectionTitle, StateBadge } from "../../components/Blocks";

import { PosterGrid } from "../../components/media";
import { useSearch, useTorrents } from "../../hooks/queries";

export function GlobalSearch({ query }: { query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const movies = useSearch("movies", query);
  const series = useSearch("series", query);
  // the server does the matching; asking for 15 avoids pulling ~1,800 rows to
  // filter them down in the browser
  const { data: torrentsData } = useTorrents({ q: query, limit: 15, poll: false });

  const torrentMatches = useMemo(
    () =>
      [
        ...(torrentsData?.qbittorrent?.data?.torrents ?? []),
        ...(torrentsData?.transmission?.data?.torrents ?? []),
      ].slice(0, 15),
    [torrentsData],
  );

  const movieResults = (movies.data ?? []) as SearchResult[];
  const seriesResults = (series.data ?? []) as SearchResult[];
  const empty =
    !movies.isFetching &&
    !series.isFetching &&
    movieResults.length === 0 &&
    seriesResults.length === 0 &&
    torrentMatches.length === 0;

  return (
    <>
      {movieResults.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.movies")}</SectionTitle>
          <PosterGrid results={movieResults.slice(0, 12)} />
        </div>
      )}
      {seriesResults.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.series")}</SectionTitle>
          <PosterGrid results={seriesResults.slice(0, 12)} />
        </div>
      )}
      {torrentMatches.length > 0 && (
        <div className="mb-6">
          <SectionTitle>{t("search.torrents")}</SectionTitle>
          <Card>
            {torrentMatches.map((tor) => (
              <Row
                key={`${tor.client}-${tor.id}`}
                onClick={() => {
                  localStorage.setItem("downloads.name", JSON.stringify(query));
                  navigate("/downloads");
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{tor.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <StateBadge state={tor.state} /> {SERVICE_LABELS[tor.client]}
                  </div>
                </div>
              </Row>
            ))}
          </Card>
        </div>
      )}
      {empty && <EmptyNote>{t("search.none")}</EmptyNote>}
    </>
  );
}
