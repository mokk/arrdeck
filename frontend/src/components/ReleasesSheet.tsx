import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { formatBytes } from "../api/format";
import type { ArrApp, ArrRelease } from "../api/types";
import { useArrReleases, useGrabArrRelease } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";
import { readPref } from "../lib/prefs";
import {
  distinctValues,
  filterReleases,
  filtersActive,
  NO_FILTERS,
  RELEASE_SORTS,
  type ReleaseFilters,
  type ReleaseSort,
  sortReleases,
} from "../lib/releases";
import { Sheet } from "./Sheet";

// Radix Select cannot hold an empty value, so "any" travels as this.
const ANY = "__any__";

/** The size filter is typed in GB, in whichever GB the sizes are shown in. */
const gbToBytes = (gb: string) => {
  const n = Number.parseFloat(gb.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n * (readPref("sizes") === "decimal" ? 1000 : 1024) ** 3;
};

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
      <SelectTrigger size="sm" aria-label={label} className="w-auto max-w-44 bg-secondary">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || ANY} value={o.value || ANY}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReleaseRow({
  r,
  grabbed,
  busy,
  onGrab,
}: {
  r: ArrRelease;
  grabbed: boolean;
  busy: boolean;
  onGrab: () => void;
}) {
  const { t } = useTranslation();
  const score = r.custom_format_score;
  const details = [
    ...(r.custom_formats ?? []),
    ...(r.languages ?? []),
    r.edition,
    r.full_season ? t("releases.seasonPack") : null,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3 border-t border-border py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className={cn(!r.approved && "opacity-60")}>
          <div className="break-words text-sm font-medium [overflow-wrap:anywhere]">
            {r.title}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {r.quality ? `${r.quality} · ` : ""}
            {formatBytes(r.size)} · {r.seeders ?? "?"}/{r.leechers ?? "?"} · {r.indexer}
            {r.protocol ? ` (${r.protocol})` : ""}
            {r.age_days != null ? ` · ${Math.round(r.age_days)}d` : ""}
          </div>
          {(r.release_group || score != null || details.length > 0) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {r.release_group && <span className="font-medium">{r.release_group}</span>}
              {score != null && score !== 0 && (
                <span
                  title={t("releases.score")}
                  className={cn("font-medium", score > 0 ? "text-success" : "text-destructive")}
                >
                  {score > 0 ? `+${score}` : score}
                </span>
              )}
              {details.length > 0 && <span>{details.join(" · ")}</span>}
            </div>
          )}
        </div>
        {!r.approved && (r.rejections ?? []).length > 0 && (
          <div className="mt-1 text-xs text-warning">
            <div className="font-medium">{t("releases.rejected")}</div>
            <ul className="list-disc pl-4">
              {(r.rejections ?? []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Button size="sm" disabled={busy || grabbed} onClick={onGrab}>
        {grabbed ? t("add.grabbed") : t("add.grab")}
      </Button>
    </div>
  );
}

/** Interactive search: list actual releases from the arr's indexers, grab one. */
export function ReleasesSheet({
  app,
  params,
  title,
  onClose,
}: {
  app: ArrApp;
  params: {
    movieId?: number;
    seriesId?: number;
    season?: number;
    episodeId?: number;
    bookId?: number;
  };
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useArrReleases(app, params, true);
  const grab = useGrabArrRelease(app);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());
  const [sort, setSort] = usePersistentState<ReleaseSort>("releases.sort", "best");
  const [filters, setFilters] = useState<ReleaseFilters>(NO_FILTERS);
  // typed as text so "1." and "" survive; parsed into the filter below
  const [sizeText, setSizeText] = useState({ min: "", max: "" });
  const setFilter = (patch: Partial<ReleaseFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const setSize = (end: "min" | "max", text: string) => {
    setSizeText((s) => ({ ...s, [end]: text }));
    setFilter({ [end === "min" ? "minBytes" : "maxBytes"]: gbToBytes(text) });
  };
  const reset = () => {
    setFilters(NO_FILTERS);
    setSizeText({ min: "", max: "" });
  };

  const qualities = useMemo(() => distinctValues(data ?? [], (r) => r.quality), [data]);
  const groups = useMemo(() => distinctValues(data ?? [], (r) => r.release_group), [data]);
  const shown = useMemo(
    () => sortReleases(filterReleases(data ?? [], filters), sort),
    [data, filters, sort],
  );

  return (
    <Sheet title={t("releases.interactive")} subtitle={title} onClose={onClose}>
      {isLoading && (
        <>
          <div className="mb-3 text-xs text-muted-foreground">{t("releases.searching")}</div>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full rounded-xl" />
          ))}
        </>
      )}
      {error && <div className="py-2 text-sm text-destructive">{(error as Error).message}</div>}
      {data && data.length > 0 && (
        <div className="mb-2 space-y-2">
          <Input
            type="search"
            value={filters.text}
            onChange={(e) => setFilter({ text: e.target.value })}
            placeholder={t("releases.filterTitle")}
            aria-label={t("releases.filterTitle")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as ReleaseSort)}>
              <SelectTrigger
                size="sm"
                aria-label={t("releases.sortBy")}
                className="w-auto bg-secondary"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELEASE_SORTS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`releases.sort.${o}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {qualities.length > 1 && (
              <FilterSelect
                label={t("releases.quality")}
                value={filters.quality}
                onChange={(quality) => setFilter({ quality })}
                options={[
                  { value: "", label: t("releases.anyQuality") },
                  ...qualities.map((q) => ({ value: q, label: q })),
                ]}
              />
            )}
            {groups.length > 1 && (
              <FilterSelect
                label={t("releases.group")}
                value={filters.group}
                onChange={(group) => setFilter({ group })}
                options={[
                  { value: "", label: t("releases.anyGroup") },
                  ...groups.map((g) => ({ value: g, label: g })),
                ]}
              />
            )}
            <button
              type="button"
              aria-pressed={filters.approvedOnly}
              onClick={() => setFilter({ approvedOnly: !filters.approvedOnly })}
              className={cn(
                focusRing,
                "h-8 rounded-full px-3 text-xs font-medium",
                filters.approvedOnly
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {t("releases.approvedOnly")}
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("releases.size")}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={sizeText.min}
              onChange={(e) => setSize("min", e.target.value)}
              placeholder={t("releases.min")}
              aria-label={t("releases.minSize")}
              className="h-8 w-16 px-2 text-center"
            />
            <span aria-hidden="true">–</span>
            <Input
              type="text"
              inputMode="decimal"
              value={sizeText.max}
              onChange={(e) => setSize("max", e.target.value)}
              placeholder={t("releases.max")}
              aria-label={t("releases.maxSize")}
              className="h-8 w-16 px-2 text-center"
            />
            <span>GB</span>
            <span className="ml-auto tabular-nums">
              {t("releases.shown", { shown: shown.length, total: data.length })}
            </span>
          </div>
        </div>
      )}
      {shown.map((r) => (
        <ReleaseRow
          key={r.guid}
          r={r}
          busy={grab.isPending}
          grabbed={grabbed.has(r.guid)}
          onGrab={() =>
            grab.mutate(
              { guid: r.guid, indexer_id: r.indexer_id },
              { onSuccess: () => setGrabbed(new Set(grabbed).add(r.guid)) },
            )
          }
        />
      ))}
      {data && data.length > 0 && shown.length === 0 && (
        <div className="py-3 text-sm text-muted-foreground">
          {t("releases.noMatch")}
          {filtersActive(filters) && (
            <button
              type="button"
              onClick={reset}
              className={cn(focusRing, "ml-2 rounded text-primary underline")}
            >
              {t("releases.clearFilters")}
            </button>
          )}
        </div>
      )}
      {data && data.length === 0 && (
        <div className="py-3 text-sm text-muted-foreground">{t("releases.none")}</div>
      )}
    </Sheet>
  );
}
