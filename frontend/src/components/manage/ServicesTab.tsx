import { useTranslation } from "react-i18next";
import { useServiceSettings } from "../../hooks/queries";
import { EmptyNote, ErrorNote } from "../Blocks";
import {
  LanguagePicker,
  ServiceSettingsCard,
  StatusStrip,
  ThemePicker,
} from "./settings/connections";
import { NotificationsCard } from "./settings/notifications";
import { SecurityCard } from "./settings/security";
import { ImportLists, SettingsTransfer } from "./settings/transfer";

/* ---------------- services (connection settings) ---------------- */

const _SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
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

const _FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

export function ServiceSettingsTab() {
  const { t } = useTranslation();
  const { data, error } = useServiceSettings();
  // Appearance and language are local preferences — they live in localStorage and
  // never touch the backend. Rendering them above the early returns keeps them
  // reachable while the service settings are loading, and still reachable if
  // that request fails, which is exactly when someone may want to change one.
  const local = (
    <>
      <ThemePicker />
      <LanguagePicker />
    </>
  );
  if (error)
    return (
      <>
        {local}
        <ErrorNote>{(error as Error).message}</ErrorNote>
      </>
    );
  if (!data)
    return (
      <>
        {local}
        <EmptyNote>{t("common.loading")}</EmptyNote>
      </>
    );
  return (
    <>
      <StatusStrip />
      {local}
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
