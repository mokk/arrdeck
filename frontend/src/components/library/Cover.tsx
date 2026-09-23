// A cover, or a placeholder that still says what the title is. The arrs leave
// some titles without artwork and a poster URL can 404, and a blank grey tile
// in a grid of covers reads as "still loading" rather than "no picture".
import { useState } from "react";
import { cn } from "@/lib/utils";

/** A stable hue per title, so the same book keeps its colour between visits. */
function hue(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Cover({
  src,
  title,
  subtitle,
  className,
  compact = false,
}: {
  src?: string | null;
  title: string;
  subtitle?: string | null;
  className?: string;
  /** a list thumbnail: too small for text, so colour and an initial only */
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const base = cn("w-full rounded-xl [aspect-ratio:2/3]", compact && "rounded-md", className);
  if (src && !failed)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(base, "bg-secondary object-cover")}
      />
    );
  const h = hue(title);
  return (
    <div
      aria-hidden="true"
      className={cn(
        base,
        "flex flex-col justify-end overflow-hidden text-white",
        compact ? "items-center justify-center p-0.5" : "p-2",
      )}
      style={{ background: `linear-gradient(160deg, hsl(${h} 45% 45%), hsl(${h} 50% 22%))` }}
    >
      {compact ? (
        <span className="text-sm font-bold">{title.slice(0, 1).toUpperCase()}</span>
      ) : (
        <>
          <span className="line-clamp-4 text-sm font-bold leading-tight">{title}</span>
          {subtitle && <span className="mt-1 truncate text-[11px] opacity-80">{subtitle}</span>}
        </>
      )}
    </div>
  );
}
