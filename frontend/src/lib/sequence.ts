// The order of the list a title was opened from, so its detail page can step
// to the next or previous one — by swiping, or with the arrows in the header.
// Per tab session: a fresh visit to the page has no list to follow.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export type Route = "movie" | "series" | "book";

const KEY = "detail.sequence";
// far enough to be a deliberate swipe, straight enough not to be a scroll
const SWIPE_PX = 80;
const SLOPE = 0.6;

export function setSequence(route: Route, ids: number[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ route, ids }));
  } catch {
    /* no storage: the page just has no neighbours */
  }
}

function neighbours(route: Route, id: number): { prev: number | null; next: number | null } {
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      route: Route;
      ids: number[];
    } | null;
    if (!stored || stored.route !== route) return { prev: null, next: null };
    const i = stored.ids.indexOf(id);
    if (i === -1) return { prev: null, next: null };
    return { prev: stored.ids[i - 1] ?? null, next: stored.ids[i + 1] ?? null };
  } catch {
    return { prev: null, next: null };
  }
}

/** The neighbours of a title, and a horizontal swipe that goes to them. The
 * step replaces the history entry, so Back still returns to the list. */
export function useSequence(route: Route, id: number) {
  const navigate = useNavigate();
  const { prev, next } = neighbours(route, id);
  const go = (target: number | null) => {
    if (target != null) navigate(`/${route}/${target}`, { replace: true });
  };

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      // a strip that scrolls sideways (cast, bookshelf) keeps its own swipe
      if (target?.closest(".overflow-x-auto, [data-no-swipe], [role=dialog]")) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      start = null;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) * SLOPE) return;
      go(dx < 0 ? next : prev);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  });

  return { prev, next, goPrev: () => go(prev), goNext: () => go(next) };
}
