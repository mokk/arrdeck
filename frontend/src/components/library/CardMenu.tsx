// What a long press on a library card offers: the detail page's everyday
// actions without opening it, plus the way out to the arr and to Plex.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SERVICE_LABELS } from "../../api/format";
import type { ArrApp, LibraryKind } from "../../api/types";
import {
  useDeleteLibraryItem,
  useServices,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../../hooks/queries";
import { useConfirm } from "../Confirm";
import { BigButton } from "../media";
import { Sheet } from "../Sheet";

// Where each arr's own UI shows one title: /movie/<slug>, /series/<slug>…
const ARR_PATH: Record<LibraryKind, string> = {
  movies: "movie",
  series: "series",
  books: "book",
};

export type MenuTarget = {
  id: number;
  title: string;
  monitored?: boolean;
  slug?: string | null;
  plexUrl?: string;
};

export function CardMenu({
  kind,
  app,
  target,
  onClose,
}: {
  kind: LibraryKind;
  app: ArrApp;
  target: MenuTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const update = useUpdateLibraryItem(kind);
  const search = useTriggerSearch();
  const remove = useDeleteLibraryItem(kind);
  const [confirming, setConfirming] = useState(false);
  const webUrl = services?.find((s) => s.service === app)?.web_url;
  const arrUrl = webUrl && target.slug ? `${webUrl}/${ARR_PATH[kind]}/${target.slug}` : null;

  const confirm = useConfirm();
  const done = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const ask = (action: string, fn: () => void) => async () => {
    onClose();
    if (await confirm({ action, subject: target.title })) fn();
  };

  return (
    <Sheet title={target.title} onClose={onClose}>
      {confirming ? (
        <>
          <BigButton
            color="red"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({ id: target.id, deleteFiles: true }, { onSettled: onClose })
            }
          >
            {t("add.deleteFromDisk")}
          </BigButton>
          <BigButton
            color="red"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({ id: target.id, deleteFiles: false }, { onSettled: onClose })
            }
          >
            {t("add.removeFromLibrary")}
          </BigButton>
          <BigButton color="muted" onClick={() => setConfirming(false)}>
            {t("common.back")}
          </BigButton>
        </>
      ) : (
        <>
          <BigButton
            color="blue"
            onClick={ask(target.monitored ? t("add.unmonitor") : t("add.monitor"), () =>
              update.mutate({ id: target.id, monitored: !target.monitored }),
            )}
          >
            {target.monitored ? t("add.unmonitor") : t("add.monitor")}
          </BigButton>
          <BigButton
            color="blue"
            onClick={ask(t("add.searchNow"), () => search.mutate({ app, id: target.id }))}
          >
            {t("add.searchNow")}
          </BigButton>
          {arrUrl && (
            <BigButton
              color="blue"
              onClick={done(() => window.open(arrUrl, "_blank", "noopener"))}
            >
              {t("library.openIn", { app: SERVICE_LABELS[app] ?? app })}
            </BigButton>
          )}
          {target.plexUrl && (
            <BigButton
              color="blue"
              onClick={done(() => window.open(target.plexUrl, "_blank", "noopener"))}
            >
              {t("library.openIn", { app: "Plex" })}
            </BigButton>
          )}
          <BigButton color="red" onClick={() => setConfirming(true)}>
            {t("dl.deleteEllipsis")}
          </BigButton>
        </>
      )}
    </Sheet>
  );
}
