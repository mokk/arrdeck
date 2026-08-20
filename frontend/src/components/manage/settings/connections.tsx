// Per-service connection settings, the reachability strip and the language picker.
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

import { SERVICE_LABELS } from "../../../api/format";
import i18n, { LANGUAGES, setLanguage } from "../../../i18n";
import type { ServiceSettings } from "../../../api/types";
import { Card } from "../../Blocks";
import { useSaveServiceSettings, useStatus, useTestService } from "../../../hooks/queries";

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

export function ServiceSettingsCard({ name, initial }: { name: string; initial: ServiceSettings }) {
  const { t } = useTranslation();
  const save = useSaveServiceSettings();
  const test = useTestService();
  const [form, setForm] = useState({
    url: initial.url,
    api_key: initial.api_key,
    username: initial.username,
    password: initial.password,
  });
  const [result, setResult] = useState<string | null>(null);
  const dirty =
    form.url !== initial.url ||
    form.api_key !== initial.api_key ||
    form.username !== initial.username ||
    form.password !== initial.password;

  return (
    <Card>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{SERVICE_LABELS[name] ?? name}</span>
          <Badge
            variant="secondary"
            className={cn(
              "px-2 py-0 text-[0.68rem]",
              initial.configured ? "text-success" : "text-muted-foreground",
            )}
          >
            {initial.configured ? t("manage.configured") : t("manage.notConfigured")}
          </Badge>
          {result && (
            <span
              className={cn(
                "text-xs",
                result.startsWith("ok") ? "text-success" : "text-destructive",
              )}
            >
              {result}
            </span>
          )}
        </div>
        {SERVICE_FIELDS[name].map((field) => (
          <div key={field}>
            <Label className="mb-1 text-xs text-muted-foreground">{t(FIELD_KEYS[field])}</Label>
            <Input
              value={form[field]}
              placeholder={field === "url" ? t("manage.urlPlaceholder") : ""}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                { service: name, ...form },
                {
                  onSuccess: (r) =>
                    setResult(r.configured ? t("manage.savedOk") : t("manage.savedDisabled")),
                  onError: (e) => setResult(`error: ${(e as Error).message}`),
                },
              )
            }
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            variant="secondary"
            disabled={test.isPending || dirty}
            title={dirty ? t("manage.saveFirst") : t("manage.testSaved")}
            onClick={() =>
              test.mutate(name, {
                onSuccess: (r) => setResult(`ok: v${r.version}`),
                onError: (e) => setResult(`error: ${(e as Error).message}`),
              })
            }
          >
            {test.isPending ? t("common.testing") : t("common.test")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function StatusStrip() {
  const { t } = useTranslation();
  const { data } = useStatus();
  if (!data?.length) return null;
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {data.map((s) => (
        <div
          key={s.service}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-full bg-card px-3.5 py-2 text-xs font-semibold",
            !s.ok && "text-destructive",
          )}
        >
          <span className={cn("size-2 rounded-full", s.ok ? "bg-success" : "bg-destructive")} />
          {SERVICE_LABELS[s.service] ?? s.service}
          <span className="font-normal text-muted-foreground">
            {s.ok ? s.version : t("manage.offlineShort")}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LanguagePicker() {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{t("common.language")}</span>
        <Select value={i18n.language} onValueChange={setLanguage}>
          <SelectTrigger size="sm" className="w-auto bg-secondary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}
