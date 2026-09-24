// Trakt's public lists on the Add page: what is trending, most anticipated or
// popular right now. Tap to add, the same sheet as search results.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import type { SearchResult } from "../../api/types";
import { useTraktList } from "../../hooks/queries";
import { usePersistentState } from "../../hooks/usePersistentState";
import { SectionTitle } from "../Blocks";
import { MediaSheet } from "../media";
import { Cover } from "./Cover";

const LISTS = ["trending", "anticipated", "popular"] as const;
type List = (typeof LISTS)[number];

export function TraktRow({ kind }: { kind: "movie" | "series" }) {
  const { t } = useTranslation();
  const [which, setWhich] = usePersistentState<List>("add.traktList", "trending");
  const { data, error } = useTraktList(kind, which);
  const [open, setOpen] = useState<SearchResult | null>(null);
  if (error) return null;
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2">
        <SectionTitle>{t("add.trakt")}</SectionTitle>
        <div className="ml-auto flex gap-1">
          {LISTS.map((list) => (
            <button
              type="button"
              key={list}
              aria-pressed={which === list}
              onClick={() => setWhich(list)}
              className={cn(
                focusRing,
                "rounded-full px-2.5 py-1 text-[11px] font-semibold active:opacity-60",
                which === list ? "bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {t(`add.trakt_${list}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(data ?? []).map((r) => (
          <button
            type="button"
            key={r.remote_id}
            onClick={() => setOpen(r)}
            className={cn(focusRing, "w-24 shrink-0 text-left active:opacity-70")}
          >
            <Cover src={r.poster} title={r.title} subtitle={r.year ? String(r.year) : null} />
            <div className="mt-1 truncate text-xs font-medium">{r.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {r.in_library ? t("add.inLibrary") : (r.year ?? "")}
            </div>
          </button>
        ))}
      </div>
      {open && <MediaSheet result={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
