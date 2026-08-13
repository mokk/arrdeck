import { ArrowDownToLine, Home, PlusCircle, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { PullToRefresh } from "./components/PullToRefresh";
import { useServices } from "./hooks/queries";
import Add from "./pages/Add";
import Dashboard from "./pages/Dashboard";
import Downloads from "./pages/Downloads";
import HistoryPage from "./pages/History";
import Manage from "./pages/Manage";
import SeriesPage from "./pages/Series";

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

export default function App() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen">
      <Toaster position="top-center" />
      <PullToRefresh />
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        <RequireSetup>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/add" element={<Add />} />
            <Route path="/search" element={<Navigate to="/add" replace />} />
            <Route path="/manage" element={<Manage />} />
            <Route path="/series/:id" element={<SeriesPage />} />
            <Route path="/history" element={<HistoryPage />} />
          </Routes>
        </RequireSetup>
      </main>
      <nav className="fixed bottom-[calc(0.9rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-3xl border border-white/10 bg-card/80 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
        {TABS.map(({ to, key, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex min-w-[66px] flex-col items-center gap-0.5 rounded-2xl px-2.5 py-2 text-[0.66rem] font-semibold text-muted-foreground",
                isActive && "bg-primary/15 text-primary",
              )
            }
          >
            <Icon className="size-[22px]" strokeWidth={2} />
            {t(key)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
