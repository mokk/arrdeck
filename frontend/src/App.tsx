import { ArrowUpDown, Plus, Search, X } from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { cn, focusRing } from "@/lib/utils";
import { ConfirmProvider } from "./components/Confirm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlobalSearch } from "./components/GlobalSearch";
import { LoginScreen } from "./components/LoginScreen";
import { NotFound } from "./components/NotFound";
import { PullToRefresh } from "./components/PullToRefresh";
import { SubnavProvider, useSubnav } from "./components/subnav";
import { useActivitySince, useAuthState, useServices } from "./hooks/queries";
import { useLastSeen } from "./lib/lastSeen";
import { usePref } from "./lib/prefs";
import { useScrollMemory } from "./lib/scrollMemory";
// The library grids are the landing routes and stay in the entry chunk;
// everything else is fetched on first visit, which keeps the initial download
// small. The PWA precache globs **/*.js, so the split chunks are still
// available offline.
import { BooksPage, MoviesPage, ShowsPage } from "./pages/Library";
import { arrangeTabs, startTab, tabFor, tabsFor } from "./tabs";

const Activity = lazy(() => import("./pages/Activity"));
const Add = lazy(() => import("./pages/Add"));
const AuthorPage = lazy(() => import("./pages/Author"));
const BookPage = lazy(() => import("./pages/Book"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const CleanupPage = lazy(() => import("./pages/Cleanup"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const MoviePage = lazy(() => import("./pages/Movie"));
const PersonPage = lazy(() => import("./pages/Person"));
const PopularPage = lazy(() => import("./pages/Popular"));
const SeriesPage = lazy(() => import("./pages/Series"));
const Settings = lazy(() => import("./pages/Settings"));
const StatsPage = lazy(() => import("./pages/Stats"));
const WantedPage = lazy(() => import("./pages/Wanted"));

const configuredSet = (services: { service: string; configured: boolean }[] | undefined) =>
  new Set((services ?? []).filter((s) => s.configured).map((s) => s.service as string));

/** With zero services configured, everything except Settings is empty —
 * send the user to the connection settings instead. */
function RequireSetup({ children }: { children: ReactNode }) {
  const { data: services } = useServices();
  const location = useLocation();
  const nothingConfigured = services?.every((s) => !s.configured);
  if (nothingConfigured && !location.pathname.startsWith("/settings")) {
    return <Navigate to="/settings/connections" replace />;
  }
  return <>{children}</>;
}

/** "/" opens the first tab. Which one that is depends on what is configured,
 * so the redirect waits for /services rather than guessing Settings. */
function Home() {
  const { data: services } = useServices();
  const tabs = useArrangedTabs();
  const preferred = usePref("startTab");
  if (!services) return <RouteFallback />;
  return <Navigate to={startTab(tabs, preferred)} replace />;
}

/** The configured tabs, in the order and selection chosen in Settings. */
function useArrangedTabs() {
  const { data: services } = useServices();
  const order = usePref("tabOrder");
  const hidden = usePref("hiddenTabs");
  return arrangeTabs(tabsFor(configuredSet(services)), order, hidden);
}

function RouteFallback() {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-2xl bg-card" />
      <div className="h-24 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

function Shell() {
  const { t } = useTranslation();
  const { subnav, searchbar, sortButton, addButton } = useSubnav();
  const location = useLocation();
  useScrollMemory();
  const auth = useAuthState();
  const tabs = useArrangedTabs();
  // the Activity badge: what happened since that tab was last opened
  const lastSeen = useLastSeen();
  const hasActivity = tabs.some((tab) => tab.to === "/activity");
  const since = useActivitySince(
    lastSeen,
    hasActivity && !location.pathname.startsWith("/activity"),
  );
  const newCount = since.data?.count ?? 0;
  // the bar only appears once a service exists; Settings alone is not a bar
  const showTabs = tabs.length > 1;

  // outside the LAN a passkey session is required for anything to load
  if (auth.data && !auth.data.lan && !auth.data.authenticated) {
    return (
      <>
        <Toaster position="top-center" />
        <LoginScreen onDone={() => auth.refetch()} />
      </>
    );
  }

  const activeTab = tabFor(location.pathname, location.search);
  const isTabActive = (to: string) => activeTab === to;

  /** Re-tapping the active tab returns the page to its entrypoint:
   * first subsection, cleared search, scrolled to the top. */
  const onTabClick = (to: string, e: React.MouseEvent) => {
    if (!isTabActive(to)) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (searchbar?.value) searchbar.onClear?.();
    if (subnav) {
      if (subnav.onReset) subnav.onReset();
      else if (subnav.value !== subnav.options[0].value)
        subnav.onChange(subnav.options[0].value);
    }
  };

  const dock = searchbar || sortButton || addButton;

  return (
    <div className="min-h-screen">
      <Toaster position="top-center" />
      <GlobalSearch />
      <PullToRefresh />
      {/* opaque status-bar backdrop: scrolled content disappears cleanly
          behind it instead of showing blurred under the iOS clock/battery */}
      <div className="fixed inset-x-0 top-0 z-40 h-[calc(env(safe-area-inset-top)+2px)] bg-background" />
      <main
        className="mx-auto max-w-3xl px-4 pt-[calc(1.25rem+5px+env(safe-area-inset-top))] lg:max-w-5xl"
        style={{
          paddingBottom: `calc(${(showTabs ? 5 : 1) + (subnav ? 3.2 : 0) + (dock ? 3.8 : 0)}rem + env(safe-area-inset-bottom))`,
        }}
      >
        <RequireSetup>
          {/* keyed on the path so navigating away clears a failed route */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/books" element={<BooksPage />} />
                <Route path="/movies" element={<MoviesPage />} />
                <Route path="/shows" element={<ShowsPage />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/:section" element={<Settings />} />
                <Route path="/overview" element={<Dashboard />} />
                <Route path="/popular" element={<PopularPage />} />
                <Route path="/wanted" element={<WantedPage />} />
                <Route path="/add" element={<Add />} />
                <Route path="/author/:id" element={<AuthorPage />} />
                <Route path="/book/:id" element={<BookPage />} />
                <Route path="/movie/:id" element={<MoviePage />} />
                <Route path="/person/:id" element={<PersonPage />} />
                <Route path="/series/:id" element={<SeriesPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/cleanup" element={<CleanupPage />} />
                {/* the pre-redesign tabs; bookmarks and push deep-links still
                    carry these paths */}
                <Route path="/search" element={<Navigate to="/add" replace />} />
                <Route path="/downloads" element={<Navigate to="/activity" replace />} />
                <Route
                  path="/history"
                  element={<Navigate to="/activity?tab=history" replace />}
                />
                <Route path="/manage" element={<Navigate to="/settings" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </RequireSetup>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-50">
        {dock && (
          <div className="pointer-events-none px-4 pb-2.5">
            <div
              className={cn(
                "mx-auto flex max-w-md items-center gap-2",
                !searchbar && "justify-center",
              )}
            >
              {sortButton && (
                <button
                  type="button"
                  className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-2xl shadow-[color:var(--shadow-color)] backdrop-blur-xl active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  onClick={sortButton.open}
                  aria-label={t("common.sortBy")}
                  title={t("common.sortBy")}
                >
                  <ArrowUpDown className="size-[18px]" />
                </button>
              )}
              {searchbar && (
                <form
                  className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card/90 px-4 shadow-2xl shadow-[color:var(--shadow-color)] backdrop-blur-xl"
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
                    className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:hidden"
                    placeholder={searchbar.placeholder}
                    value={searchbar.value}
                    onChange={(e) => searchbar.onChange(e.target.value)}
                  />
                  {searchbar.value && (
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={t("common.clear")}
                      onClick={() => searchbar.onClear?.()}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </form>
              )}
              {addButton && (
                <button
                  type="button"
                  className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-[color:var(--shadow-color)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  onClick={addButton.onClick}
                  aria-label={addButton.label}
                  title={addButton.label}
                >
                  <Plus className="size-5" />
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
                  type="button"
                  key={o.value}
                  className={cn(
                    focusRing,
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
        {showTabs && (
          <nav
            className={cn(
              "bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl",
              subnav ? "border-t border-border/60" : "border-t border-border",
            )}
          >
            <div className="mx-auto flex max-w-3xl">
              {tabs.map(({ to, key, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={(e) => onTabClick(to, e)}
                  aria-current={isTabActive(to) ? "page" : undefined}
                  className={() =>
                    cn(
                      "flex flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[0.66rem] font-semibold text-muted-foreground active:opacity-60",
                      // our own match: a movie page belongs to Movies, which
                      // NavLink's prefix match would not know
                      isTabActive(to) && "text-primary",
                    )
                  }
                >
                  <span className="relative">
                    <Icon className="size-[22px]" strokeWidth={2} />
                    {to === "/activity" && newCount > 0 && (
                      <span
                        role="status"
                        className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[0.6rem] font-bold leading-4 text-primary-foreground"
                        aria-label={t("activity.newCount", { count: newCount })}
                      >
                        {newCount > 99 ? "99+" : newCount}
                      </span>
                    )}
                  </span>
                  {t(key)}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SubnavProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </SubnavProvider>
  );
}
