import { ArrowDown, ArrowUp, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet } from "./Sheet";
import type { useSort } from "./sortable";

/** Bottom drawer with sort direction + field, and optional page filters. */
export function SortSheet({
  options,
  sort,
  onClose,
  children,
}: {
  options: { key: string; label: string }[];
  sort: ReturnType<typeof useSort>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Sheet title={t("common.sortBy")} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <Button
          variant={sort.sortDir === "asc" ? "default" : "secondary"}
          className="flex-1"
          onClick={() => sort.setSortDir("asc")}
        >
          <ArrowUp /> {t("common.ascending")}
        </Button>
        <Button
          variant={sort.sortDir === "desc" ? "default" : "secondary"}
          className="flex-1"
          onClick={() => sort.setSortDir("desc")}
        >
          <ArrowDown /> {t("common.descending")}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-background/50">
        {options.map((o) => (
          <button
            type="button"
            key={o.key}
            className="flex w-full items-center justify-between border-t border-border px-4 py-2.5 text-sm first:border-t-0 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            onClick={() => sort.setSortKey(o.key)}
          >
            {o.label}
            {sort.sortKey === o.key && <Check className="size-4 text-primary" />}
          </button>
        ))}
      </div>
      {children && (
        <>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("common.filters")}
          </div>
          {children}
        </>
      )}
      <div className="h-2" />
    </Sheet>
  );
}
