import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Pull down at the top of the page to refetch everything. */
export function PullToRefresh() {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const set = (v: number) => {
      offsetRef.current = v;
      setOffset(v);
    };
    const onStart = (e: TouchEvent) => {
      startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dragged = (e.touches[0].clientY - startY.current) * 0.4;
      if (dragged > 0) set(Math.min(dragged, 90));
    };
    const onEnd = async () => {
      if (startY.current == null) return;
      startY.current = null;
      if (offsetRef.current > 55) {
        setBusy(true);
        set(60);
        await qc.invalidateQueries();
        setBusy(false);
      }
      set(0);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [qc]);

  if (offset <= 0 && !busy) return null;
  return (
    <div
      className="fixed left-1/2 top-0 z-40"
      style={{ transform: `translate(-50%, ${offset - 36}px)` }}
    >
      <div className="rounded-full bg-card p-2 shadow-lg shadow-[color:var(--shadow-color)]">
        <Loader2
          className={cn("size-5 text-primary", (busy || offset > 55) && "animate-spin")}
        />
      </div>
    </div>
  );
}
