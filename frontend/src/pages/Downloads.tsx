import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatEpoch,
  formatEta,
  formatSpeed,
  SERVICE_LABELS,
} from "../api/format";
import type { Torrent } from "../api/types";
import { Card, EmptyNote, ErrorNote, ProgressBar, Row, StateBadge } from "../components/Blocks";
import { SortSheet } from "../components/SortSheet";
import { SwipeableRow } from "../components/SwipeableRow";
import { useSort } from "../components/sortable";
import { useRegisterSortButton, useRegisterSubnav } from "../components/subnav";
import { VirtualList } from "../components/VirtualList";
import {
  useServices,
  useSetSpeedLimit,
  useSpeedLimit,
  useTorrentAction,
  useTorrents,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

const SORT_KEYS = [
  "added_on",
  "name",
  "state",
  "progress",
  "size",
  "dl_speed",
  "eta",
  "ratio",
  "uploaded",
  "tracker",
];

import { AddTorrentSheet } from "../components/downloads/AddTorrentSheet";
import { ArrQueue } from "../components/downloads/ArrQueue";
import { BulkBar } from "../components/downloads/BulkBar";
import { isPaused, TorrentSheet } from "../components/downloads/TorrentSheet";

// how many rows each client returns per request; raised by "load more"
const PAGE = 200;

export default function Downloads() {
  const { t } = useTranslation();
  const [stateFilter, setStateFilter] = usePersistentState<string>("downloads.state", "all");
  const [clients, setClients] = usePersistentState<Record<Torrent["client"], boolean>>(
    "downloads.clients",
    { qbittorrent: true, transmission: true },
  );
  const [nameFilter, setNameFilter] = usePersistentState<string>("downloads.name", "");
  const sort = useSort<Record<string, unknown>>("downloads.sort", "added_on", "desc");
  const [limit, setLimit] = useState(PAGE);
  // the name filter now reaches the server, so debounce it rather than firing a
  // request per keystroke — it used to be a free client-side filter
  const [debouncedName, setDebouncedName] = useState(nameFilter);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedName(nameFilter), 300);
    return () => clearTimeout(id);
  }, [nameFilter]);
  useEffect(() => setLimit(PAGE), []);
  const { data } = useTorrents({
    q: debouncedName,
    state: stateFilter,
    sort: sort.sortKey,
    dir: sort.sortDir,
    limit,
  });
  const { data: services } = useServices();
  const action = useTorrentAction();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const clientList = (["qbittorrent", "transmission"] as const).filter((c) =>
    configured.has(c),
  );

  const [selected, setSelected] = useState<{ torrent: Torrent; del?: boolean } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const { data: speed } = useSpeedLimit(clientList.length > 0);
  const setSpeed = useSetSpeedLimit();
  // "some", not "every": if either client is throttled the label has to say so,
  // otherwise a half-applied state reads as off. Tapping then releases both.
  const throttled = clientList.some((c) => speed?.[c] === true);
  useRegisterSortButton(() => setSortOpen(true));
  useRegisterSubnav(
    [
      { value: "add", label: `+ ${t("dl.addTorrent")}` },
      ...(clientList.length > 0
        ? [{ value: "throttle", label: throttled ? t("dl.throttleOn") : t("dl.throttle") }]
        : []),
      { value: "select", label: selectMode ? t("dl.done") : t("dl.select") },
    ],
    selectMode ? "select" : throttled ? "throttle" : "",
    (v) => {
      if (v === "add") {
        setAdding(true);
      } else if (v === "throttle") {
        setSpeed.mutate({ clients: [...clientList], enabled: !throttled });
      } else {
        setSelectMode(!selectMode);
        setChecked(new Set());
      }
    },
    // entrypoint reset: leave select mode, clear filters, close sheets
    () => {
      setSelectMode(false);
      setChecked(new Set());
      setSortOpen(false);
      setNameFilter("");
    },
  );

  const toggleChecked = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  };

  const all: Torrent[] = useMemo(
    () => [
      ...(data?.qbittorrent?.data?.torrents ?? []),
      ...(data?.transmission?.data?.torrents ?? []),
    ],
    [data],
  );
  const states = Array.from(
    new Set([
      ...(data?.qbittorrent?.data?.states ?? []),
      ...(data?.transmission?.data?.states ?? []),
    ]),
  ).sort();
  const matchTotal =
    (data?.qbittorrent?.data?.total ?? 0) + (data?.transmission?.data?.total ?? 0);

  // state and name filtering happen server-side now; the client toggle between
  // clients stays local, and the merge of two independently-capped lists is
  // re-sorted so the visible order is globally correct
  const shown = useMemo(
    () =>
      sort.sortRows(
        all.filter((torrent) => clients[torrent.client]) as unknown as Record<
          string,
          unknown
        >[],
      ) as unknown as Torrent[],
    [all, clients, sort.sortRows],
  );

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <Button
      key={label}
      size="sm"
      variant={active ? "default" : "secondary"}
      className="shrink-0 rounded-full"
      onClick={onClick}
    >
      {label}
    </Button>
  );

  return (
    <>
      {clientList.map((client) => {
        const block = data?.[client];
        return block && !block.ok && block.data == null ? (
          <ErrorNote key={client}>
            {t("dash.serviceOffline", { service: SERVICE_LABELS[client], error: block.error })}
          </ErrorNote>
        ) : null;
      })}
      <Card>
        <VirtualList
          items={shown}
          renderRow={(torrent) =>
            selectMode ? (
              <Row
                key={`${torrent.client}-${torrent.id}`}
                onClick={() => toggleChecked(`${torrent.client}-${torrent.id}`)}
              >
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(`${torrent.client}-${torrent.id}`)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(`${torrent.client}-${torrent.id}`) ? "✓" : ""}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{torrent.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    <StateBadge state={torrent.state} /> {formatBytes(torrent.size)}
                  </div>
                </div>
              </Row>
            ) : (
              <SwipeableRow
                key={`${torrent.client}-${torrent.id}`}
                onTap={() => setSelected({ torrent })}
                actions={(close) => (
                  <>
                    <button
                      type="button"
                      className="flex-1 bg-primary text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      onClick={() => {
                        action.mutate({
                          client: torrent.client,
                          action: isPaused(torrent) ? "resume" : "pause",
                          ids: [torrent.id],
                        });
                        close();
                      }}
                    >
                      {isPaused(torrent) ? t("common.resume") : t("common.pause")}
                    </button>
                    <button
                      type="button"
                      className="flex-1 bg-destructive text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      onClick={() => {
                        setSelected({ torrent, del: true });
                        close();
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </>
                )}
              >
                <Row className="border-t-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{torrent.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      <StateBadge state={torrent.state} />{" "}
                      <StateBadge state={SERVICE_LABELS[torrent.client]} raw />
                      {torrent.tracker ? ` ${torrent.tracker} · ` : " "}
                      {formatBytes(torrent.size)}
                      {/* total sent, not the current rate — the number that says
                      whether a torrent has actually given anything back */}
                      {` · ↑${formatBytes(torrent.uploaded)}`}
                      {torrent.ratio != null ? ` (${torrent.ratio.toFixed(2)})` : ""}
                      {torrent.dl_speed > 0 || torrent.ul_speed > 0
                        ? ` · ↓${formatSpeed(torrent.dl_speed)} ↑${formatSpeed(torrent.ul_speed)}`
                        : ""}
                      {torrent.eta != null ? ` · ${formatEta(torrent.eta)}` : ""}
                      {torrent.error ? ` · ${torrent.error}` : ""}
                    </div>
                    <ProgressBar value={torrent.progress} />
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {formatEpoch(torrent.added_on)?.split(",")[0]}
                  </div>
                </Row>
              </SwipeableRow>
            )
          }
        />
        {shown.length === 0 && <EmptyNote>{t("dl.noMatch")}</EmptyNote>}
        {/* each client is capped independently, so "more" exists when either
            has rows the server held back */}
        {matchTotal > shown.length && (
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {t("dl.showing", { shown: shown.length, total: matchTotal })}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setLimit(limit + PAGE)}>
              {t("dl.loadMore")}
            </Button>
          </div>
        )}
      </Card>
      {selectMode && (
        <BulkBar
          selected={checked}
          torrents={shown}
          onDone={() => {
            setChecked(new Set());
            setSelectMode(false);
          }}
        />
      )}
      <div className="mb-6 mt-2 text-center text-xs text-muted-foreground">
        {t("dl.shownOfTotal", { shown: shown.length, total: all.length })}
      </div>
      <ArrQueue />
      {selected && (
        <TorrentSheet
          torrent={selected.torrent}
          startAtDelete={selected.del}
          onClose={() => setSelected(null)}
        />
      )}
      {adding && clientList.length > 0 && (
        <AddTorrentSheet clients={clientList} onClose={() => setAdding(false)} />
      )}
      {sortOpen && (
        <SortSheet
          options={SORT_KEYS.map((key) => ({ key, label: t(`dl.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        >
          <Input
            className="mb-3"
            placeholder={t("dl.filterByName")}
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {clientList.length > 1 &&
              clientList.map((c) =>
                chip(SERVICE_LABELS[c], clients[c], () =>
                  setClients({ ...clients, [c]: !clients[c] }),
                ),
              )}
            {chip(t("dl.all", { count: all.length }), stateFilter === "all", () =>
              setStateFilter("all"),
            )}
            {states.map((s) =>
              chip(
                `${t(`state.${s}`, { defaultValue: s })} (${all.filter((x) => x.state === s).length})`,
                stateFilter === s,
                () => setStateFilter(s),
              ),
            )}
          </div>
        </SortSheet>
      )}
    </>
  );
}
