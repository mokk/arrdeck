// The parts the Movie and Series detail pages have in common. The series page
// used to show a title and season cards and nothing else, while the movie page
// had a synopsis, badges, external links, a profile picker and actions — so the
// shared shell lives here rather than being copied into the second page.
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDayTime } from "../api/format";
import type { HistoryEvent, Options, WatchedItem } from "../api/types";
import { Card, Row, SectionTitle, StateBadge } from "./Blocks";
import { BigButton } from "./media";
import { WatchedDot } from "./WatchedDot";

export function DetailHeader({
  title,
  year,
  watched,
}: {
  title: string | null | undefined;
  year?: number | null;
  watched?: WatchedItem;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="mb-4 mt-1 flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("common.back")}
        onClick={() => navigate(-1)}
      >
        <ChevronLeft className="size-6" />
      </Button>
      <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">
        {title ?? "…"} <span className="font-semibold text-muted-foreground">{year ?? ""}</span>
      </h1>
      <WatchedDot item={watched} />
    </div>
  );
}

export type ExternalLink = { label: string; url: string };

/** Poster, synopsis and the metadata line. `badges` differs per kind — a film
 * has a runtime, a series has a network and an episode ratio — so the caller
 * supplies it rather than the component guessing from optional fields. */
export function DetailHero({
  poster,
  overview,
  badges,
  links,
}: {
  poster?: string | null;
  overview?: string | null;
  badges: ReactNode;
  links: ExternalLink[];
}) {
  return (
    <div className="mb-5 flex gap-4">
      {poster && (
        <img
          src={poster}
          alt=""
          className="w-28 shrink-0 rounded-xl bg-card object-cover [aspect-ratio:2/3]"
        />
      )}
      <div className="min-w-0">
        <div className="text-sm leading-relaxed text-muted-foreground">{overview}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {badges}
        </div>
        {links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-primary"
              >
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DetailProfileSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value?: number | null;
  options: Options | undefined;
  disabled: boolean;
  onChange: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value != null ? String(value) : undefined}
      disabled={disabled || !options}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger size="sm" className="w-auto bg-secondary">
        <SelectValue placeholder={t("add.qualityProfile")} />
      </SelectTrigger>
      <SelectContent>
        {(options?.quality_profiles ?? []).map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Monitor, search, delete — and whatever else the page adds. Delete is behind
 * a confirmation because both variants are irreversible and one of them removes
 * files. */
export function DetailActions({
  monitored,
  busy,
  onToggleMonitor,
  onSearch,
  onDelete,
  confirming,
  onConfirmingChange,
  extra,
}: {
  monitored: boolean;
  busy: boolean;
  onToggleMonitor: () => void;
  onSearch: () => void;
  onDelete: (deleteFiles: boolean) => void;
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
  /** Interactive search on the movie page; the series page offers it per season
   * instead, because Sonarr's release lookup needs a season or an episode. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  if (confirming)
    return (
      <>
        <BigButton color="red" disabled={busy} onClick={() => onDelete(true)}>
          {t("add.deleteFromDisk")}
        </BigButton>
        <BigButton color="red" disabled={busy} onClick={() => onDelete(false)}>
          {t("add.removeFromLibrary")}
        </BigButton>
        <BigButton color="muted" onClick={() => onConfirmingChange(false)}>
          {t("common.back")}
        </BigButton>
      </>
    );
  return (
    <>
      <BigButton color="blue" disabled={busy} onClick={onToggleMonitor}>
        {monitored ? t("add.unmonitor") : t("add.monitor")}
      </BigButton>
      <BigButton color="blue" disabled={busy} onClick={onSearch}>
        {t("add.searchNow")}
      </BigButton>
      {extra}
      <BigButton color="red" onClick={() => onConfirmingChange(true)}>
        {t("dl.deleteEllipsis")}
      </BigButton>
    </>
  );
}

export function DetailHistory({ history }: { history: HistoryEvent[] | null | undefined }) {
  const { t } = useTranslation();
  if (!history?.length) return null;
  return (
    <>
      <SectionTitle>{t("dash.recentHistory")}</SectionTitle>
      <Card>
        {history.map((h, i) => (
          // The arrs' history rows carry no stable id of their own here, and the
          // list is a fixed snapshot that never reorders.
          // biome-ignore lint/suspicious/noArrayIndexKey: snapshot, never reordered
          <Row key={i}>
            <StateBadge state={h.type} />
            <div className="ml-auto text-xs text-muted-foreground">{formatDayTime(h.date)}</div>
          </Row>
        ))}
      </Card>
    </>
  );
}
