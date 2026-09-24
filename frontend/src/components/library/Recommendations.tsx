// "Recommended for you": films Radarr suggests from what is already in the
// library — no Overseerr needed. Tap to add; the cross is "not interested", which
// becomes a Radarr exclusion so no list brings the film back either.
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import type { SearchResult } from "../../api/types";
import { useDismissRecommendation, useRecommendations } from "../../hooks/queries";
import { SectionTitle } from "../Blocks";
import { MediaSheet } from "../media";
import { Cover } from "./Cover";

const SHOWN = 20;

export function RecommendationsRow() {
  const { t } = useTranslation();
  const { data } = useRecommendations(true);
  const dismiss = useDismissRecommendation();
  const [open, setOpen] = useState<SearchResult | null>(null);
  const rows = (data ?? []).slice(0, SHOWN);
  if (rows.length === 0) return null;
  return (
    <section className="mb-5">
      <SectionTitle>{t("add.recommended")}</SectionTitle>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {rows.map((r) => (
          <div key={r.remote_id} className="relative w-24 shrink-0">
            <button
              type="button"
              onClick={() => setOpen(r)}
              className={cn(focusRing, "w-full text-left active:opacity-70")}
            >
              <Cover src={r.poster} title={r.title} subtitle={r.year ? String(r.year) : null} />
              <div className="mt-1 truncate text-xs font-medium">{r.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{r.year ?? ""}</div>
            </button>
            <button
              type="button"
              aria-label={t("add.notInterested", { title: r.title })}
              title={t("add.notInterested", { title: r.title })}
              onClick={() => dismiss.mutate(r.remote_id)}
              className={cn(
                focusRing,
                "absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white active:opacity-70",
              )}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {open && <MediaSheet result={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
