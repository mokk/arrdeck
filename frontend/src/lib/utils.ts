import { type ClassValue, clsx } from "clsx";
import type { KeyboardEvent } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Focus ring for hand-rolled <button> chips. The shadcn Button brings its own;
 * these are the ones that had no keyboard affordance at all. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Props that make a non-button element operable by keyboard.
 *
 * Several rows and cards are `<div onClick>` for layout reasons; without this
 * they can be tapped but not reached with a keyboard at all. Returns nothing
 * when there's no handler, so a static row stays static. */
export function clickable(onClick?: () => void) {
  if (!onClick) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    },
  } as const;
}
