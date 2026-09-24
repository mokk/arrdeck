// "On your Plex watchlist": what you marked in Plex and do not have yet. Tap to
// add it — the same sheet as search results.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import type { SearchResult } from "../../api/types";
import { usePlexWatchlist } from "../../hooks/queries";
import { SectionTitle } from "../Blocks";
import { MediaSheet } from "../media";
import { Cover } from "./Cover";

export function WatchlistRow({ kind }: { kind: "movie" | "series" }) {
  const { t } = useTranslation();
  const { data } = usePlexWatchlist(true);
  const [open, setOpen] = useState<SearchResult | null>(null);
  const mine = (data ?? []).filter((r) => r.kind === kind);
  const missing = mine.filter((r) => !r.in_library);
  if (missing.length === 0) return null;
  return (
    <section className="mb-5">
      <SectionTitle>
        {t("add.watchlist")}{" "}
        <span className="font-normal normal-case text-muted-foreground">
          {t("add.watchlistHave", { have: mine.length - missing.length, total: mine.length })}
        </span>
      </SectionTitle>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {missing.map((r) => (
          <button
            type="button"
            key={r.remote_id}
            onClick={() => setOpen(r)}
            className={cn(focusRing, "w-24 shrink-0 text-left active:opacity-70")}
          >
            <Cover src={r.poster} title={r.title} subtitle={r.year ? String(r.year) : null} />
            <div className="mt-1 truncate text-xs font-medium">{r.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{r.year ?? ""}</div>
          </button>
        ))}
      </div>
      {open && <MediaSheet result={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
