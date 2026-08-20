// Adding a torrent by magnet, url or .torrent file.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SERVICE_LABELS } from "../../api/format";
import { Segmented } from "../../components/Blocks";
import { Sheet } from "../../components/Sheet";
import { useAddTorrent, useQbitCategories } from "../../hooks/queries";

// how many rows each client returns per request; raised by "load more"

export function AddTorrentSheet({
  clients,
  onClose,
}: {
  clients: readonly ("qbittorrent" | "transmission")[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddTorrent();
  const [client, setClient] = useState<string>(clients[0]);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [paused, setPaused] = useState(false);
  const { data: categories } = useQbitCategories(client === "qbittorrent");

  const canSubmit = url.trim().length > 0 || file != null;

  return (
    <Sheet title={t("dl.addTorrent")} onClose={onClose}>
      {clients.length > 1 && (
        <Segmented
          options={clients.map((c) => ({ value: c, label: SERVICE_LABELS[c] }))}
          value={client as "qbittorrent" | "transmission"}
          onChange={setClient}
        />
      )}
      <Label className="mb-1 text-xs text-muted-foreground">{t("dl.magnetOrUrl")}</Label>
      <Input
        value={url}
        placeholder="magnet:?xt=…"
        onChange={(e) => {
          setUrl(e.target.value);
          if (e.target.value) setFile(null);
        }}
      />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" asChild>
          <label className="cursor-pointer">
            {t("dl.chooseFile")}
            <input
              type="file"
              accept=".torrent,application/x-bittorrent"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) setUrl("");
              }}
            />
          </label>
        </Button>
        {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
      </div>
      {client === "qbittorrent" && (categories?.length ?? 0) > 0 && (
        <div className="mt-3">
          <Label className="mb-1 text-xs text-muted-foreground">{t("dl.category")}</Label>
          <Select
            value={category || "__none__"}
            onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-full bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dl.noCategory")}</SelectItem>
              {(categories ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="mt-3">
        <Button
          variant={paused ? "default" : "secondary"}
          size="sm"
          onClick={() => setPaused(!paused)}
        >
          {t("dl.startPaused")}: {paused ? "on" : "off"}
        </Button>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          className="h-11 flex-1 rounded-xl"
          disabled={!canSubmit || add.isPending}
          onClick={() =>
            add.mutate(
              {
                client,
                url: url.trim() || undefined,
                file: file ?? undefined,
                category,
                paused,
              },
              { onSuccess: onClose },
            )
          }
        >
          {add.isPending ? "…" : t("dl.addTorrent")}
        </Button>
      </div>
    </Sheet>
  );
}
