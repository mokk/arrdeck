// Controls both library lists use: profile select, delete confirmation, bulk bar.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Options } from "../../../api/types";

import {
  useBulkDeleteLibrary,
  useBulkLibrary,
  useBulkSearchLibrary,
  useTags,
} from "../../../hooks/queries";

/* ---------------- libraries ---------------- */

export function ProfileSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number | null | undefined;
  options: Options | undefined;
  disabled: boolean;
  onChange: (id: number) => void;
}) {
  return (
    <Select
      value={value != null ? String(value) : undefined}
      disabled={disabled || !options}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger size="sm" className="w-auto bg-secondary">
        <SelectValue placeholder="Profile" />
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

export function DeleteButtons({
  pending,
  onDelete,
}: {
  pending: boolean;
  onDelete: (deleteFiles: boolean) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
        {t("common.delete")}
      </Button>
    );
  return (
    <div className="flex gap-1.5">
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => onDelete(true)}>
        {t("manage.plusFiles")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        disabled={pending}
        onClick={() => onDelete(false)}
      >
        {t("manage.entryOnly")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("common.cancel")}
        onClick={() => setConfirming(false)}
      >
        ✕
      </Button>
    </div>
  );
}

export function LibraryBulkBar({
  kind,
  selected,
  options,
  onDone,
}: {
  kind: "movies" | "series";
  selected: Set<number>;
  options: Options | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkLibrary(kind);
  const bulkDelete = useBulkDeleteLibrary(kind);
  const bulkSearch = useBulkSearchLibrary(kind);
  const { data: tags } = useTags(kind === "movies" ? "radarr" : "sonarr");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [taggingOff, setTaggingOff] = useState(false);
  const ids = [...selected];
  const pending = bulk.isPending || bulkDelete.isPending || bulkSearch.isPending;

  return (
    <div className="fixed bottom-[calc(7.4rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-card/90 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <span className="px-1 text-xs text-muted-foreground">
        {t("dl.selected", { count: ids.length })}
      </span>
      {confirmingDelete ? (
        <>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              bulkDelete.mutate({ ids, delete_files: true }, { onSettled: onDone })
            }
          >
            {t("manage.plusFiles")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              bulkDelete.mutate({ ids, delete_files: false }, { onSettled: onDone })
            }
          >
            {t("manage.entryOnly")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("common.cancel")}
            onClick={() => setConfirmingDelete(false)}
          >
            ✕
          </Button>
        </>
      ) : (
        <>
          <ProfileSelect
            value={null}
            options={options}
            disabled={pending || !ids.length}
            onChange={(pid) =>
              bulk.mutate({ ids, quality_profile_id: pid }, { onSettled: onDone })
            }
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: true }, { onSettled: onDone })}
          >
            {t("add.monitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: false }, { onSettled: onDone })}
          >
            {t("add.unmonitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => {
              bulkSearch.mutate(ids);
              onDone();
            }}
          >
            {t("common.search")}
          </Button>
          {(tags?.length ?? 0) > 0 && (
            <>
              {/* one row of tag buttons; the toggle flips them between
                  applying and removing so each tag needs only one button */}
              <Button
                size="sm"
                variant="secondary"
                className={taggingOff ? "text-destructive" : undefined}
                onClick={() => setTaggingOff(!taggingOff)}
              >
                {taggingOff ? t("manage.tagRemoving") : t("manage.tagAdding")}
              </Button>
              {(tags ?? []).map((tag) => (
                <Button
                  key={tag.id}
                  size="sm"
                  variant="secondary"
                  disabled={pending || !ids.length}
                  onClick={() =>
                    bulk.mutate(
                      { ids, tags: [tag.id], apply_tags: taggingOff ? "remove" : "add" },
                      { onSettled: onDone },
                    )
                  }
                >
                  {tag.label}
                </Button>
              ))}
            </>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={!ids.length}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("common.delete")}
          </Button>
        </>
      )}
    </div>
  );
}
