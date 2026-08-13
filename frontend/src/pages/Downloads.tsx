import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SERVICE_LABELS,
  formatBytes,
  formatEpoch,
  formatEta,
  formatSpeed,
} from "../api/format";
import type { Torrent } from "../api/types";
import {
  Card,
  EmptyNote,
  ErrorNote,
  ProgressBar,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import { Sheet } from "../components/Sheet";
import { SwipeableRow } from "../components/SwipeableRow";
import { SortBar, useSort } from "../components/sortable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  useBlocklistRetry,
  useQueue,
  useQueueRemove,
  useServices,
  useTorrentAction,
  useTorrentCategory,
  useTorrentDetails,
  useTorrentLimits,
  useTorrentRecheck,
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
  "tracker",
];

function isPaused(t: Torrent) {
  return t.state === "paused" || t.state === "completed";
}

function SheetButton({
  color,
  disabled,
  onClick,
  children,
}: {
  color?: "blue" | "red" | "muted";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={color === "muted" ? "ghost" : "secondary"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-2 h-11 w-full rounded-xl text-[0.95rem]",
        color === "blue" && "text-primary",
        color === "red" && "text-destructive",
        color === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}

function TorrentDetailsSection({ torrent }: { torrent: Torrent }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTorrentDetails(torrent.client, torrent.id, true);
  const limits = useTorrentLimits();
  const category = useTorrentCategory();
  const recheck = useTorrentRecheck();
  const [dl, setDl] = useState<string | null>(null);
  const [ul, setUl] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="mb-3 h-16 w-full rounded-xl" />;
  if (!data) return null;

  const dlVal = dl ?? String(data.dl_limit_kib ?? 0);
  const ulVal = ul ?? String(data.ul_limit_kib ?? 0);
  const limitsDirty =
    Number(dlVal) !== (data.dl_limit_kib ?? 0) || Number(ulVal) !== (data.ul_limit_kib ?? 0);

  return (
    <div className="mb-3">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div>
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.dlLimit")}</Label>
          <Input
            className="h-8 w-28"
            inputMode="numeric"
            value={dlVal}
            onChange={(e) => setDl(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div>
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.ulLimit")}</Label>
          <Input
            className="h-8 w-28"
            inputMode="numeric"
            value={ulVal}
            onChange={(e) => setUl(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!limitsDirty || limits.isPending}
          onClick={() =>
            limits.mutate({
              client: torrent.client,
              id: torrent.id,
              dl_kib: Number(dlVal) || 0,
              ul_kib: Number(ulVal) || 0,
            })
          }
        >
          {t("dl.apply")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate({ client: torrent.client, ids: [torrent.id] })}
        >
          {t("dl.recheck")}
        </Button>
      </div>
      {torrent.client === "qbittorrent" && (data.categories?.length ?? 0) > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("dl.category")}</Label>
          <Select
            value={data.category ?? "__none__"}
            disabled={category.isPending}
            onValueChange={(v) =>
              category.mutate({ id: torrent.id, category: v === "__none__" ? "" : v })
            }
          >
            <SelectTrigger size="sm" className="w-auto bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dl.noCategory")}</SelectItem>
              {(data.categories ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("dl.files")} ({data.files.length})
      </div>
      <div className="max-h-40 overflow-y-auto rounded-xl bg-background/50 px-3 py-1">
        {data.files.map((f) => (
          <div
            key={f.name}
            className="flex items-center gap-2 border-t border-border py-1.5 text-xs first:border-t-0"
          >
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatBytes(f.size)} · {Math.round(f.progress * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TorrentSheet({
  torrent,
  startAtDelete,
  onClose,
}: {
  torrent: Torrent;
  startAtDelete?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useTorrentAction();
  const [confirmingDelete, setConfirmingDelete] = useState(startAtDelete ?? false);
  const paused = isPaused(torrent);

  const run = (a: "pause" | "resume" | "delete", deleteData?: boolean) =>
    action.mutate(
      { client: torrent.client, action: a, ids: [torrent.id], deleteData },
      { onSettled: onClose },
    );

  return (
    <Sheet
      title={torrent.name}
      subtitle={`${SERVICE_LABELS[torrent.client]} · ${formatBytes(torrent.size)} · ${t("dl.ratio")} ${
        torrent.ratio?.toFixed(2) ?? "—"
      } · ${t("dl.added")} ${formatEpoch(torrent.added_on)}${torrent.tracker ? ` · ${torrent.tracker}` : ""}`}
      onClose={onClose}
    >
      {confirmingDelete ? (
        <>
          <SheetButton color="red" disabled={action.isPending} onClick={() => run("delete", true)}>
            {t("dl.deleteWithFiles")}
          </SheetButton>
          <SheetButton color="red" disabled={action.isPending} onClick={() => run("delete", false)}>
            {t("dl.deleteOnly")}
          </SheetButton>
          <SheetButton color="muted" onClick={() => setConfirmingDelete(false)}>
            {t("common.back")}
          </SheetButton>
        </>
      ) : (
        <>
          <TorrentDetailsSection torrent={torrent} />
          <SheetButton
            color="blue"
            disabled={action.isPending}
            onClick={() => run(paused ? "resume" : "pause")}
          >
            {paused ? t("common.resume") : t("common.pause")}
          </SheetButton>
          <SheetButton color="red" onClick={() => setConfirmingDelete(true)}>
            {t("dl.deleteEllipsis")}
          </SheetButton>
          <SheetButton color="muted" onClick={onClose}>
            {t("common.cancel")}
          </SheetButton>
        </>
      )}
    </Sheet>
  );
}

function ArrQueue() {
  const { t } = useTranslation();
  const { data } = useQueue();
  const remove = useQueueRemove();
  const retry = useBlocklistRetry();
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
            </div>
          </Row>
        ))}
      </Card>
    </div>
  );
}

function BulkBar({
  selected,
  torrents,
  onDone,
}: {
  selected: Set<string>;
  torrents: Torrent[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const action = useTorrentAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = (act: "pause" | "resume" | "delete", deleteData?: boolean) => {
    const byClient: Record<string, string[]> = {};
    for (const torrent of torrents) {
      if (selected.has(`${torrent.client}-${torrent.id}`)) {
        (byClient[torrent.client] ??= []).push(torrent.id);
      }
    }
    for (const [client, ids] of Object.entries(byClient)) {
      action.mutate({ client: client as Torrent["client"], action: act, ids, deleteData });
    }
    onDone();
  };

  return (
    <div className="fixed bottom-[calc(4.2rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-card/90 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <span className="px-1 text-xs text-muted-foreground">
        {t("dl.selected", { count: selected.size })}
      </span>
      {confirmingDelete ? (
        <>
          <Button size="sm" variant="destructive" onClick={() => run("delete", true)}>
            {t("manage.plusFiles")}
          </Button>
          <Button size="sm" variant="secondary" className="text-destructive" onClick={() => run("delete", false)}>
            {t("manage.entryOnly")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            ✕
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => run("pause")}>
            {t("common.pause")}
          </Button>
          <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => run("resume")}>
            {t("common.resume")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={!selected.size}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("common.delete")}
          </Button>
        </>
      )}
    </div>
  );
}

export default function Downloads() {
  const { t } = useTranslation();
  const { data } = useTorrents();
  const { data: services } = useServices();
  const action = useTorrentAction();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const clientList = (["qbittorrent", "transmission"] as const).filter((c) =>
    configured.has(c),
  );

  const [stateFilter, setStateFilter] = usePersistentState<string>("downloads.state", "all");
  const [clients, setClients] = usePersistentState<Record<Torrent["client"], boolean>>(
    "downloads.clients",
    { qbittorrent: true, transmission: true },
  );
  const [nameFilter, setNameFilter] = usePersistentState<string>("downloads.name", "");
  const sort = useSort<Record<string, unknown>>("downloads.sort", "added_on", "desc");
  const [selected, setSelected] = useState<{ torrent: Torrent; del?: boolean } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

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
  const states = Array.from(new Set(all.map((torrent) => torrent.state))).sort();

  const shown = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    const filtered = all.filter(
      (torrent) =>
        (stateFilter === "all" || torrent.state === stateFilter) &&
        clients[torrent.client] &&
        (!needle || torrent.name.toLowerCase().includes(needle)),
    );
    return sort.sortRows(filtered as unknown as Record<string, unknown>[]) as unknown as Torrent[];
  }, [all, stateFilter, clients, nameFilter, sort.sortKey, sort.sortDir]);

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
      <div className="mb-4">
        <Input
          placeholder={t("dl.filterByName")}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto [scrollbar-width:none]">
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
      <div className="mb-4 flex items-center gap-2">
        <SortBar
          options={SORT_KEYS.map((key) => ({ key, label: t(`dl.sort.${key}`) }))}
          sort={sort}
        />
        <Button
          size="sm"
          variant={selectMode ? "default" : "secondary"}
          className="ml-auto rounded-full"
          onClick={() => {
            setSelectMode(!selectMode);
            setChecked(new Set());
          }}
        >
          {selectMode ? t("dl.done") : t("dl.select")}
        </Button>
      </div>
      {clientList.map((client) => {
        const block = data?.[client];
        return block && !block.ok && block.data == null ? (
          <ErrorNote key={client}>
            {t("dash.serviceOffline", { service: SERVICE_LABELS[client], error: block.error })}
          </ErrorNote>
        ) : null;
      })}
      <Card>
        {shown.slice(0, 200).map((torrent) =>
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
                  className="flex-1 bg-primary text-xs font-semibold text-white"
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
                  className="flex-1 bg-destructive text-xs font-semibold text-white"
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
          ),
        )}
        {shown.length === 0 && <EmptyNote>{t("dl.noMatch")}</EmptyNote>}
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
        {t("dl.shownOfTotal", { shown: Math.min(shown.length, 200), total: all.length })}
        {shown.length > 200 ? t("dl.narrowFilters") : ""}
      </div>
      <ArrQueue />
      {selected && (
        <TorrentSheet
          torrent={selected.torrent}
          startAtDelete={selected.del}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
