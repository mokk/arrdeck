// Press and hold on touch, right-click with a mouse. The click that follows a
// long press is swallowed, so holding a card opens its menu without also
// opening the title.
import { useRef } from "react";

const HOLD_MS = 450;
const SLOP_PX = 10; // a finger that moves this far is scrolling, not holding

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return; // the mouse has a context menu
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        start.current = null;
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (fired.current) return; // touch already opened it
      onLongPress();
    },
    /** Wrap the element's click: false when the click ends a long press. */
    shouldClick: () => {
      if (!fired.current) return true;
      fired.current = false;
      return false;
    },
  };
}
