// A thin have/total bar: a collection, a series of books, a season.
export function Completion({ have, total }: { have: number; total: number }) {
  if (total <= 0) return null;
  const percent = Math.min(100, Math.round((have / total) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={have}
      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div
        className={percent === 100 ? "h-full bg-success" : "h-full bg-primary"}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
