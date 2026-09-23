// The A–Z strip down the right edge of a title-sorted library, like the index
// in iOS Contacts: tap a letter, or drag along the strip, to jump.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";

/** The index letter for a sort value: its first character, digits and
 * punctuation under "#". Letters come from the sorted list itself, so the strip
 * follows whatever order the sort produced, Æ Ø Å included. */
export function letterOf(value: unknown): string {
  const first = String(value ?? "")
    .trim()
    .slice(0, 1)
    .toUpperCase();
  return first && first.toLowerCase() !== first ? first : "#";
}

export const letterAnchor = (letter: string) => `letter-${encodeURIComponent(letter)}`;

function jump(letter: string) {
  document.getElementById(letterAnchor(letter))?.scrollIntoView({ block: "start" });
}

export function LetterScrubber({ letters }: { letters: string[] }) {
  const { t } = useTranslation();
  const current = useRef<string | null>(null);
  if (letters.length < 4) return null;

  const scrubTo = (x: number, y: number) => {
    const letter = (document.elementFromPoint(x, y) as HTMLElement | null)?.dataset.scrubLetter;
    if (letter && letter !== current.current) {
      current.current = letter;
      jump(letter);
    }
  };

  return (
    <nav
      aria-label={t("library.jumpTo")}
      className="fixed right-0.5 top-1/2 z-30 flex -translate-y-1/2 touch-none select-none flex-col items-center rounded-full bg-card/70 px-0.5 py-1 backdrop-blur"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubTo(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => e.buttons && scrubTo(e.clientX, e.clientY)}
      onPointerUp={() => {
        current.current = null;
      }}
    >
      {letters.map((letter) => (
        <button
          type="button"
          key={letter}
          data-scrub-letter={letter}
          aria-label={t("library.jumpToLetter", { letter })}
          className={cn(
            focusRing,
            "flex h-[18px] w-5 items-center justify-center rounded text-[10px] font-semibold text-primary",
          )}
          onClick={() => jump(letter)}
        >
          {letter}
        </button>
      ))}
    </nav>
  );
}
