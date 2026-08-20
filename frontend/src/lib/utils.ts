import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Focus ring for hand-rolled <button> chips. The shadcn Button brings its own;
 * these are the ones that had no keyboard affordance at all. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background";
