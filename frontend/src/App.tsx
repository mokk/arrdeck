import {
  ArrowDownToLine,
  ArrowUpDown,
  Home,
  PlusCircle,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { PullToRefresh } from "./components/PullToRefresh";
import { SubnavProvider, useSubnav } from "./components/subnav";
import { useServices } from "./hooks/queries";
import Add from "./pages/Add";
import Dashboard from "./pages/Dashboard";
import Downloads from "./pages/Downloads";
import HistoryPage from "./pages/History";
import CalendarPage from "./pages/Calendar";
import Manage from "./pages/Manage";
import SeriesPage from "./pages/Series";
import WantedPage from "./pages/Wanted";

/** With zero services configured, everything except Manage is empty —
 * send the user to the Services settings instead. */
function RequireSetup({ children }: { children: ReactNode }) {
  const { data: services } = useServices();
  const location = useLocation();
  const nothingConfigured = services != null && services.every((s) => !s.configured);
  if (nothingConfigured && location.pathname !== "/manage") {
    return <Navigate to="/manage" replace />;
  }
  return <>{children}</>;
}

const TABS = [
  { to: "/", key: "nav.home", icon: Home, end: true },
  { to: "/downloads", key: "nav.downloads", icon: ArrowDownToLine },
  { to: "/add", key: "nav.add", icon: PlusCircle },
  { to: "/manage", key: "nav.manage", icon: Settings2 },
];

function Shell() {
  const { t } = useTranslation();
  const { subnav, searchbar, sortButton } = useSubnav();
  const location = useLocation();

  const isTabActive = (to: string, end?: boolean) =>
    end ? location.pathname === to : location.pathname.startsWith(to);

  /** Re-tapping the active tab returns the page to its entrypoint:
   * first subsection, cleared search, scrolled to the top. */
  const onTabClick = (to: string, end: boolean | undefined, e: React.MouseEvent) => {
    if (!isTabActive(to, end)) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (searchbar?.value) searchbar.onClear?.();
    if (subnav) {
      if (subnav.onReset) subnav.onReset();
      else if (subnav.value !== subnav.options[0].value) subnav.onChange(subnav.options[0].value);
    }
  };

  return (
    <div className="min-h-screen">
      <Toaster position="top-center" />
      <PullToRefresh />
      {/* opaque status-bar backdrop: scrolled content disappears cleanly
          behind it instead of showing blurred under the iOS clock/battery */}
      <div className="fixed inset-x-0 top-0 z-40 h-[calc(env(safe-area-inset-top)+2px)] bg-background" />
      <main
        className="mx-auto max-w-3xl px-4 pt-[calc(1.25rem+5px+env(safe-area-inset-top))] lg:max-w-5xl"
        style={{
          paddingBottom: `calc(${5 + (subnav ? 3.2 : 0) + (searchbar || sortButton ? 3.8 : 0)}rem + env(safe-area-inset-bottom))`,
        }}
      >
        <RequireSetup>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/add" element={<Add />} />
            <Route path="/search" element={<Navigate to="/add" replace />} />
            <Route path="/manage" element={<Manage />} />
            <Route path="/series/:id" element={<SeriesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/wanted" element={<WantedPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
          </Routes>
        </RequireSetup>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-50">
        {(searchbar || sortButton) && (
          <div className="pointer-events-none px-4 pb-2.5">
            <div className={cn("mx-auto flex max-w-md items-center gap-2", !searchbar && "justify-center")}>
              {searchbar && (
                <form
                  className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-card/90 px-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchbar.onSubmit?.();
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                >
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    type="search"
                    enterKeyHint="search"
                    className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                    placeholder={searchbar.placeholder}
                    value={searchbar.value}
                    onChange={(e) => searchbar.onChange(e.target.value)}
                  />
                  {searchbar.value && (
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground active:opacity-60"
                      onClick={() => searchbar.onClear?.()}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </form>
              )}
              {sortButton && (
                <button
                  className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-card/90 text-muted-foreground shadow-2xl shadow-black/50 backdrop-blur-xl active:opacity-60"
                  onClick={sortButton.open}
                  title={t("common.sortBy")}
                >
                  <ArrowUpDown className="size-[18px]" />
                </button>
              )}
            </div>
          </div>
        )}
        {subnav && (
          <div className="border-t border-border bg-card/85 backdrop-blur-xl">
            <div className="mx-auto flex max-w-3xl gap-1 px-2 py-1.5">
              {subnav.options.map((o) => (
                <button
                  key={o.value}
                  className={cn(
                    "flex-1 rounded-full px-2 py-1.5 text-xs font-semibold text-muted-foreground active:opacity-60",
                    o.value === subnav.value && "bg-primary/15 text-primary",
                  )}
                  onClick={() => subnav.onChange(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <nav
          className={cn(
            "bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl",
            subnav ? "border-t border-border/60" : "border-t border-border",
          )}
        >
          <div className="mx-auto flex max-w-3xl">
            {TABS.map(({ to, key, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={(e) => onTabClick(to, end, e)}
                className={({ isActive }) =>
                  cn(
                    "flex flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[0.66rem] font-semibold text-muted-foreground active:opacity-60",
                    isActive && "text-primary",
                  )
                }
              >
                <Icon className="size-[22px]" strokeWidth={2} />
                {t(key)}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SubnavProvider>
      <Shell />
    </SubnavProvider>
  );
}
