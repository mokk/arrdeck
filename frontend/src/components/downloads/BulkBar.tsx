// Actions applied to a multi-selection of torrents.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import type { Torrent } from "../../api/types";

import { useTorrentAction } from "../../hooks/queries";

// how many rows each client returns per request; raised by "load more"

export function BulkBar({
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
