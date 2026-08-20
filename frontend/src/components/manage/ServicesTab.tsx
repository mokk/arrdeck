import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../api/client";
import { passkeysSupported, registerPasskey } from "../../lib/passkey";
import { SERVICE_LABELS } from "../../api/format";
import i18n, { LANGUAGES, setLanguage } from "../../i18n";
import type { ServiceSettings } from "../../api/types";
import { Card, EmptyNote, ErrorNote } from "../Blocks";
import {
  useAuthState,
  useDeletePasskey,
  useRevokeSessions,
  useSessions,
  useLogout,
  usePasskeys,
  useSetupCode,
  useImportSettings,
  useInstallWebhooks,
  usePushEvents,
  useImportLists,
  usePushRules,
  useSyncImportLists,
  useToggleImportList,
  useSavePushRules,
  useTags,
  usePushSubscribe,
  useSavePushEvents,
  useTestPush,
  useWebhookStatus,
  useSaveServiceSettings,
  useServiceSettings,
  useStatus,
  useTestService,
  useVapidKey,
} from "../../hooks/queries";
import { ServiceSettingsCard, StatusStrip, LanguagePicker } from "./settings/connections";
import { SecurityCard } from "./settings/security";
import { NotificationsCard } from "./settings/notifications";
import { ImportLists, SettingsTransfer } from "./settings/transfer";

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

export function ServiceSettingsTab() {
  const { t } = useTranslation();
  const { data, error } = useServiceSettings();
  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  if (!data) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  return (
    <>
      <StatusStrip />
      <LanguagePicker />
      <SecurityCard />
      <NotificationsCard />
      <ImportLists />
      <SettingsTransfer />
      {Object.entries(data).map(([name, conf]) => (
        <ServiceSettingsCard
          key={`${name}-${conf.url}-${conf.api_key}`}
          name={name}
          initial={conf}
        />
      ))}
    </>
  );
}
