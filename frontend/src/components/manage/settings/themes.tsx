// Settings → Display → Theme: arrdeck's own colours or an editor palette, as
// swatches that preview the palette in the mode it will show in.
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, focusRing } from "@/lib/utils";
import { PALETTE_INFO } from "../../../lib/palettes";
import { DARK_ONLY, PALETTES, type Palette, readPalette, setPalette } from "../../../lib/theme";
import { SectionTitle } from "../../Blocks";
import { ThemePicker } from "./connections";

export function PalettePicker() {
  const { t } = useTranslation();
  // Read once: the value only changes through this control, and the applied
  // palette lives on <html>, not in React state.
  const [current, setCurrent] = useState<Palette>(readPalette);
  const mode = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [shownMode, setShownMode] = useState(mode);
  // the light/dark control beside it changes <html data-theme>; follow it so
  // the swatches preview the mode that will actually show
  useEffect(() => {
    const observer = new MutationObserver(() => setShownMode(mode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <SectionTitle>{t("display.theme")}</SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PALETTES.map((key) => {
          const info = PALETTE_INFO[key];
          const sw = (shownMode === "light" && info.light) || info.dark;
          const on = current === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setPalette(key);
                setCurrent(key);
                setShownMode(mode());
              }}
              className={cn(
                focusRing,
                "overflow-hidden rounded-xl border-2 text-left active:opacity-80",
                on ? "border-primary" : "border-transparent",
              )}
              style={{ background: sw.background, color: sw.foreground }}
            >
              <div className="p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{info.name}</span>
                  {on && <Check className="size-4 shrink-0" style={{ color: sw.primary }} />}
                </div>
                <div className="truncate text-[11px] opacity-70">
                  {DARK_ONLY.has(key)
                    ? t("display.darkOnly")
                    : (info.variants ?? t("display.lightAndDark"))}
                </div>
                <div
                  className="mt-2 flex gap-1 rounded-lg p-1.5"
                  style={{ background: sw.card }}
                >
                  {[sw.primary, sw.success, sw.warning, sw.destructive].map((c) => (
                    <span
                      key={c}
                      className="h-3 flex-1 rounded-full"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <ThemePicker />
      {DARK_ONLY.has(current) && (
        <p className="mx-1 mb-2 mt-1 text-xs text-muted-foreground">
          {t("display.darkOnlyHint", { name: PALETTE_INFO[current].name })}
        </p>
      )}
    </>
  );
}
