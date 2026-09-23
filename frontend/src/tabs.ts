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

/** The tabs in the order and selection chosen under Settings → Display.
 * Tabs missing from the saved order (a service configured since) keep their
 * natural place after the ordered ones; Settings can never be hidden, or
 * there would be no way back to the setting. */
export function arrangeTabs(tabs: AppTab[], order: string[], hidden: string[]): AppTab[] {
  const rank = (tab: AppTab) => {
    const i = order.indexOf(tab.to);
    return i === -1 ? order.length + tabs.indexOf(tab) : i;
  };
  return [...tabs]
    .filter((tab) => tab.to === "/settings" || !hidden.includes(tab.to))
    .sort((a, b) => rank(a) - rank(b));
}

/** Where "/" goes: the chosen start tab when it is still there, else the first. */
export function startTab(tabs: AppTab[], preferred: string): string {
  return tabs.find((tab) => tab.to === preferred)?.to ?? tabs[0].to;
}

/** Which tab owns a location, so a movie page lights up Movies and the Add
 * screen lights up the library it was opened for. Detail routes are singular
 * (/movie/12) while the tabs are plural (/movies), hence the table. */
export function tabFor(pathname: string, search = ""): string {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  switch (first) {
    case "/movie":
      return "/movies";
    case "/series":
      return "/shows";
    case "/book":
    case "/author":
      return "/books";
    case "/add": {
      const kind = new URLSearchParams(search).get("tab");
      if (kind === "series") return "/shows";
      if (kind === "books") return "/books";
      return "/movies";
    }
    case "/downloads":
    case "/history":
      return "/activity";
    case "/overview":
    case "/popular":
    case "/wanted":
    case "/stats":
    case "/manage":
      return "/settings";
    default:
      return first;
  }
}
