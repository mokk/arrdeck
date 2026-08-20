// Import lists, plus settings export and full backup/restore.
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

import { api } from "../../../api/client";

import { SERVICE_LABELS } from "../../../api/format";
import i18n, { LANGUAGES, setLanguage } from "../../../i18n";

import { Card } from "../../Blocks";
import {
  useImportSettings,
  useImportLists,
  useSyncImportLists,
  useToggleImportList,
} from "../../../hooks/queries";

/* ---------------- services (connection settings) ---------------- */

const SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
  radarr: ["url", "api_key"],
  sonarr: ["url", "api_key"],
  prowlarr: ["url", "api_key"],
  overseerr: ["url", "api_key"],
  qbittorrent: ["url", "username", "password"],
  transmission: ["url"],
  gluetun: ["url", "api_key"],
  bazarr: ["url", "api_key"],
  plex: ["url", "api_key"],
  prometheus: ["url"],
};

const FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

export function ImportLists() {
  const { t } = useTranslation();
  const { data } = useImportLists(true);
  const toggle = useToggleImportList();
  const sync = useSyncImportLists();
  if (!data || data.length === 0) return null;
  const apps = Array.from(new Set(data.map((l) => l.app)));
  return (
    <Card>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("manage.importLists")}</span>
          <div className="flex gap-1.5">
            {apps.map((app) => (
              <Button
                key={app}
                size="sm"
                variant="secondary"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(app, { onSuccess: () => toast.success(t("manage.syncStarted")) })
                }
              >
                {t("manage.syncApp", { app: SERVICE_LABELS[app] ?? app })}
              </Button>
            ))}
          </div>
        </div>
        {data.map((list) => (
          <div key={`${list.app}-${list.id}`} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{list.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[SERVICE_LABELS[list.app] ?? list.app, list.implementation, list.monitor]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <Button
              size="sm"
              variant={list.enabled ? "default" : "secondary"}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ app: list.app, id: list.id })}
            >
              {list.enabled ? t("manage.enabled") : t("manage.disabled")}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SettingsTransfer() {
  const { t } = useTranslation();
  const importSettings = useImportSettings();
  const [busy, setBusy] = useState(false);

  const download = (data: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportSettings = async () => {
    download(await api.get("/settings/export"), "arrdeck-settings.json");
  };

  // the full snapshot carries passkey keys and the VAPID private key, so it is
  // a credential file — labelled separately from the plain settings export
  const exportBackup = async () => {
    setBusy(true);
    try {
      download(await api.get("/backup"), "arrdeck-backup.json");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File) => {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.version) {
        const counts = await api.post<Record<string, number>>("/restore", parsed);
        toast.success(
          t("manage.restored", {
            services: counts.services ?? 0,
            passkeys: counts.credentials ?? 0,
          }),
        );
      } else {
        // a settings-only export from before backups existed
        importSettings.mutate(parsed.services ?? parsed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportSettings}>
            {t("manage.export")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={exportBackup}>
            {t("manage.backup")}
          </Button>
          <Button variant="secondary" size="sm" asChild disabled={busy}>
            <label className="cursor-pointer">
              {t("manage.import")}
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) restore(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{t("manage.backupHint")}</span>
      </div>
    </Card>
  );
}
