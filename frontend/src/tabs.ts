import {
  ArrowDownUp,
  BookOpen,
  CalendarDays,
  Film,
  type LucideIcon,
  Settings2,
  Tv,
} from "lucide-react";

export interface AppTab {
  to: string;
  key: string;
  icon: LucideIcon;
}

/** The bottom bar, one tab per configured library plus the shared screens.
 * Mirrors the iOS app: Books · Movies · Shows · Activity · Calendar · Settings.
 * With nothing configured only Settings remains, and the bar itself is
 * hidden until a service has been added. */
export function tabsFor(configured: Set<string>): AppTab[] {
  const hasArr = ["radarr", "sonarr", "readarr"].some((s) => configured.has(s));
  const hasClient = ["qbittorrent", "transmission"].some((s) => configured.has(s));
  const tabs: AppTab[] = [];
  if (configured.has("readarr")) tabs.push({ to: "/books", key: "nav.books", icon: BookOpen });
  if (configured.has("radarr")) tabs.push({ to: "/movies", key: "nav.movies", icon: Film });
  if (configured.has("sonarr")) tabs.push({ to: "/shows", key: "nav.shows", icon: Tv });
  if (hasArr || hasClient)
    tabs.push({ to: "/activity", key: "nav.activity", icon: ArrowDownUp });
  if (hasArr) tabs.push({ to: "/calendar", key: "nav.calendar", icon: CalendarDays });
  tabs.push({ to: "/settings", key: "nav.settings", icon: Settings2 });
  return tabs;
}
