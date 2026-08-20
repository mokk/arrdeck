import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

/** Window-scrolled virtual list — renders only visible rows, so full
 * 1000+-item lists stay smooth on a phone. */
export function VirtualList<T>({
  items,
  estimateSize = 72,
  renderRow,
}: {
  items: T[];
  estimateSize?: number;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={vi.key}
          ref={virtualizer.measureElement}
          data-index={vi.index}
          className="absolute inset-x-0"
          style={{ transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)` }}
        >
          {renderRow(items[vi.index], vi.index)}
        </div>
      ))}
    </div>
  );
}
