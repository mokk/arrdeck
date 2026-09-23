// Back to where you were. The browser's own restoration runs before a lazy
// route has rendered its list, so going back from a detail page used to land at
// the top of a 125-title grid. Positions are kept per history entry; a new page
// starts at the top, a back/forward waits for the page to be tall enough.
import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORAGE_KEY = "scroll.positions";
const MAX_ENTRIES = 50;
// about a second and a half: long enough for a cached query to render, short
// enough that a page that never grows does not hold the scroll hostage
const RETRY_MS = 25;
const MAX_TRIES = 60;

function positions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function remember(key: string, y: number) {
  const all = positions();
  delete all[key];
  all[key] = y;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old];
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: nothing to restore later */
  }
}

export function useScrollMemory() {
  const location = useLocation();
  const navigation = useNavigationType();

  useEffect(() => {
    window.history.scrollRestoration = "manual";
  }, []);

  useEffect(() => {
    const key = location.key;
    let timer = 0;
    let restoring = navigation === "POP";
    // The position is noted on every scroll and stored when the page is left.
    // Reading scrollY at that point would be too late: the next route has
    // already rendered and the browser has clamped the old offset to its height.
    let latest = restoring ? (positions()[key] ?? 0) : 0;
    if (restoring) {
      const target = latest;
      let tries = 0;
      const attempt = () => {
        const room = document.documentElement.scrollHeight - window.innerHeight;
        if (room >= target || tries++ > MAX_TRIES) {
          window.scrollTo(0, target);
          restoring = false;
          return;
        }
        timer = window.setTimeout(attempt, RETRY_MS);
      };
      attempt();
    } else {
      window.scrollTo(0, 0);
    }
    const onScroll = () => {
      // while waiting to restore, the page sits at the top; that is not a
      // position worth keeping
      if (!restoring) latest = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      remember(key, latest);
    };
  }, [location.key, navigation]);
}
