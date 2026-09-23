// Reading status on a book: to read, reading, read. Tapping the one that is
// on clears it. Kept in arrdeck, so it follows you between the PWA and the app.
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import { formatWhen } from "../../api/format";
import { type ReadingStatus, useReading, useSetReading } from "../../hooks/queries";

export const READING: ReadingStatus[] = ["to_read", "reading", "read"];

export function ReadingControl({ bookId }: { bookId: number }) {
  const { t } = useTranslation();
  const { data } = useReading();
  const set = useSetReading();
  const current = data?.[String(bookId)];
  return (
    <div className="mb-5">
      <fieldset
        className="flex gap-1 rounded-full border-0 bg-secondary p-1"
        aria-label={t("reading.label")}
      >
        {READING.map((status) => {
          const on = current?.status === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={on}
              disabled={set.isPending}
              onClick={() => set.mutate({ id: bookId, status: on ? null : status })}
              className={cn(
                focusRing,
                "flex-1 rounded-full py-1.5 text-sm font-medium",
                on ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(`reading.${status}`)}
            </button>
          );
        })}
      </fieldset>
      {current?.status === "read" && current.finished_at && (
        <div className="mt-1.5 px-2 text-xs text-muted-foreground">
          {t("reading.finished", {
            when: formatWhen(new Date(current.finished_at * 1000).toISOString()),
          })}
        </div>
      )}
    </div>
  );
}
