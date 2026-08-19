import { useTranslation } from "react-i18next";
import { useRegisterSubnav } from "../components/subnav";
import { useServices } from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";
import { ServiceSettingsTab } from "../components/manage/ServicesTab";
import { Indexers } from "../components/manage/Indexers";
import { MovieLibrary, SeriesLibrary } from "../components/manage/Libraries";

/* ---------------- page ---------------- */

type Tab = "movies" | "series" | "indexers" | "services";

export default function Manage() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const tabs: { value: Tab; label: string }[] = [
    ...(configured.has("radarr") ? [{ value: "movies" as Tab, label: t("manage.movies") }] : []),
    ...(configured.has("sonarr") ? [{ value: "series" as Tab, label: t("manage.series") }] : []),
    ...(configured.has("prowlarr")
      ? [{ value: "indexers" as Tab, label: t("manage.indexers") }]
      : []),
    // services (connection settings) deliberately last
    { value: "services" as Tab, label: t("manage.services") },
  ];

  const [storedTab, setTab] = usePersistentState<Tab>("manage.tab", "movies");
  const tab = tabs.some((t) => t.value === storedTab) ? storedTab : tabs[0].value;
  useRegisterSubnav(tabs, tab, (v) => setTab(v as Tab));

  return (
    <>
      {tab === "movies" && <MovieLibrary />}
      {tab === "series" && <SeriesLibrary />}
      {tab === "indexers" && <Indexers />}
      {tab === "services" && <ServiceSettingsTab />}
    </>
  );
}
