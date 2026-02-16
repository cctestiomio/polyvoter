"use client";

export type MarketEvent = {
  slug: string;

  // Preferred (from poly-hit80 rows)
  startTsSec?: number; // seconds
  endTsSec?: number;   // seconds

  // Legacy fallback (if some code still sets this)
  ts?: number; // ms epoch

  hitSide: "Yes" | "No" | null;
  hitPrice: number | null;

  outcome: "Open" | "Yes" | "No";
};

function yesNoPillClasses(side: "Yes" | "No" | null) {
  if (side === "Yes") return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300";
  if (side === "No") return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
  return "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300";
}

function outcomePillClasses(outcome: MarketEvent["outcome"]) {
  if (outcome === "Yes") return yesNoPillClasses("Yes");
  if (outcome === "No") return yesNoPillClasses("No");
  return "bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/20 dark:text-zinc-400";
}

function toFiniteNumber(x: any): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeWindow(e: MarketEvent): { startSec: number | null; endSec: number | null } {
  const startFromField = toFiniteNumber(e.startTsSec);
  const endFromField = toFiniteNumber(e.endTsSec);

  if (startFromField != null) {
    const end = endFromField ?? (startFromField + 300);
    return { startSec: startFromField, endSec: end };
  }

  const tsMs = toFiniteNumber(e.ts);
  if (tsMs != null) {
    const startSec = Math.floor(tsMs / 1000);
    return { startSec, endSec: startSec + 300 };
  }

  return { startSec: null, endSec: null };
}

const fmtEt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function fmtEtHmSafe(tsSec: number): string | null {
  const d = new Date(tsSec * 1000);
  // Hard guard: never let Intl format an invalid Date
  if (!Number.isFinite(d.getTime())) return null;
  return fmtEt.format(d);
}

function fmtEtRangeSafe(startTsSec: number, endTsSec: number) {
  const a = fmtEtHmSafe(startTsSec);
  const b = fmtEtHmSafe(endTsSec);
  if (!a || !b) return "—";
  return `${a}–${b} ET`;
}

export default function TaAnalysisTable(props: {
  events: MarketEvent[];
  taAccuracy: number;
  totalSignals: number;
  onEventClick?: (ev: MarketEvent) => void;
}) {
  const { events, onEventClick } = props;

  return (
    <section className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
      <div className="bg-white px-4 py-3 text-sm font-medium text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
        Event Log <span className="ml-2 text-xs font-normal text-zinc-500">Last {events.length} events</span>
      </div>

      <div className="overflow-x-auto bg-white dark:bg-zinc-950">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr className="border-b border-zinc-200 dark:border-zinc-900">
              <th className="px-4 py-3">Slug window (ET)</th>
              <th className="px-4 py-3">Signal (First ≥80%)</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Slug</th>
            </tr>
          </thead>

          <tbody>
            {events.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-zinc-500" colSpan={5}>
                  No signals recorded yet.
                </td>
              </tr>
            ) : null}

            {events.map((e) => {
              const { startSec, endSec } = normalizeWindow(e);
              const windowLabel =
                startSec != null && endSec != null ? fmtEtRangeSafe(startSec, endSec) : "—";

              const resolved = e.outcome === "Yes" || e.outcome === "No";
              const hasSignal = e.hitSide === "Yes" || e.hitSide === "No";
              const isHit = resolved && hasSignal ? e.hitSide === e.outcome : null;

              return (
                <tr
                  key={`${e.slug}-${startSec ?? e.ts ?? "x"}`}
                  className="border-b border-zinc-200/70 dark:border-zinc-900/70 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30 cursor-pointer"
                  onClick={() => onEventClick?.(e)}
                  title="Click to drill into this slug"
                >
                  <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-200">
                    {windowLabel}
                  </td>

                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${yesNoPillClasses(e.hitSide)}`}>
                      {e.hitSide ?? "—"}
                    </span>
                    {Number.isFinite(e.hitPrice as any) ? (
                      <span className="ml-2 font-mono text-xs text-zinc-500">{(e.hitPrice as number).toFixed(3)}</span>
                    ) : null}
                  </td>

                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${outcomePillClasses(e.outcome)}`}>
                      {e.outcome === "Open" ? "Pending..." : e.outcome}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    {isHit === null ? (
                      <span className="text-zinc-500">—</span>
                    ) : isHit ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Hit</span>
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400 font-medium">✗ Miss</span>
                    )}
                  </td>

                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {e.slug}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
