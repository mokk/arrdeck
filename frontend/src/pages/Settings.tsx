// The hub the iOS app calls Settings: links to the screens that used to be
// tabs of their own (Overview, Popular, Wanted, Statistics), then the arr
// management sections, then where each service lives.

import type { LucideIcon } from "lucide-react";
import {
  Antenna,
  Ban,
  BarChart3,
  BookOpen,
  CalendarPlus,
  Captions,
  ChevronRight,
  Cog,
  Eraser,
  Flame,
  FlaskConical,
  LayoutGrid,
  Link2,
  Palette,
  SearchCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Card, Row, SectionTitle } from "../components/Blocks";
import { DetailHeader } from "../components/detail";
import { Indexers } from "../components/manage/Indexers";
import { ServiceSettingsTab } from "../components/manage/ServicesTab";
import { SystemTab } from "../components/manage/System";
import { DisplaySettings } from "../components/manage/settings/display";
import { IcalSettings } from "../components/manage/settings/ical";
import { NotificationsCard } from "../components/manage/settings/notifications";
import { OpdsSettings } from "../components/manage/settings/opds";
import { SubtitlesTool } from "../components/manage/subtitles";
import { ExclusionsTool, ParseTool } from "../components/manage/tools";
import { useServices } from "../hooks/queries";

type Section =
  | "display"
  | "notifications"
  | "opds"
  | "ical"
  | "exclusions"
  | "parse"
  | "subtitles"
  | "indexers"
  | "system"
  | "connections";
const SECTIONS: Section[] = [
  "display",
  "notifications",
  "opds",
  "ical",
  "exclusions",
  "parse",
  "subtitles",
  "indexers",
  "system",
  "connections",
];

function LinkRow({ icon: Icon, label, to }: { icon: LucideIcon; label: string; to: string }) {
  const navigate = useNavigate();
  return (
    <Row onClick={() => navigate(to)}>
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Row>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { section } = useParams();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const hasArr = ["radarr", "sonarr", "readarr"].some((s) => configured.has(s));
  const hasProwlarr = configured.has("prowlarr");

  if (section) {
    if (!SECTIONS.includes(section as Section)) return <Navigate to="/settings" replace />;
    return (
      <>
        <DetailHeader title={t(`settings.${section}`)} />
        {section === "display" && <DisplaySettings configured={configured} />}
        {section === "notifications" && <NotificationsCard />}
        {section === "opds" && <OpdsSettings />}
        {section === "ical" && <IcalSettings />}
        {section === "exclusions" && <ExclusionsTool />}
        {section === "parse" && (
          <ParseTool apps={["radarr", "sonarr"].filter((a) => configured.has(a))} />
        )}
        {section === "subtitles" && <SubtitlesTool />}
        {section === "indexers" && <Indexers />}
        {section === "system" && <SystemTab />}
        {section === "connections" && <ServiceSettingsTab />}
      </>
    );
  }

  return (
    <>
      <h1 className="mb-4 mt-1 text-2xl font-extrabold tracking-tight">
        {t("settings.title")}
      </h1>
      <Card>
        <LinkRow icon={Palette} label={t("settings.display")} to="/settings/display" />
      </Card>
      <SectionTitle>{t("settings.more")}</SectionTitle>
      <Card>
        <LinkRow icon={LayoutGrid} label={t("settings.overview")} to="/overview" />
        {hasProwlarr && <LinkRow icon={Flame} label={t("settings.popular")} to="/popular" />}
        <LinkRow icon={BarChart3} label={t("settings.stats")} to="/stats" />
        {hasArr && <LinkRow icon={Eraser} label={t("settings.cleanup")} to="/cleanup" />}
        {hasArr && <LinkRow icon={SearchCheck} label={t("settings.wanted")} to="/wanted" />}
      </Card>
      {(hasProwlarr || hasArr) && (
        <>
          <SectionTitle>{t("settings.services")}</SectionTitle>
          <Card>
            {hasProwlarr && (
              <LinkRow icon={Antenna} label={t("settings.indexers")} to="/settings/indexers" />
            )}
            <LinkRow icon={Cog} label={t("settings.system")} to="/settings/system" />
            {hasArr && (
              <LinkRow icon={Ban} label={t("settings.exclusions")} to="/settings/exclusions" />
            )}
            {(configured.has("radarr") || configured.has("sonarr")) && (
              <LinkRow icon={FlaskConical} label={t("settings.parse")} to="/settings/parse" />
            )}
            {hasArr && (
              <LinkRow icon={CalendarPlus} label={t("settings.ical")} to="/settings/ical" />
            )}
            {configured.has("bazarr") && (
              <LinkRow
                icon={Captions}
                label={t("settings.subtitles")}
                to="/settings/subtitles"
              />
            )}
            {configured.has("readarr") && (
              <LinkRow icon={BookOpen} label={t("settings.opds")} to="/settings/opds" />
            )}
          </Card>
        </>
      )}
      <Card>
        <LinkRow icon={Link2} label={t("settings.connections")} to="/settings/connections" />
      </Card>
      <p className="mx-1 mb-6 text-xs text-muted-foreground">{t("settings.connectionsHint")}</p>
    </>
  );
}
