"use client";

export type TaPredRow = {
  slug: string;
  startTsSec: number;
  endTsSec: number;

  prediction: "Yes" | "No" | "Neutral" | null;
  outcome: "Open" | "Yes" | "No";
};

function predPillClasses(x: TaPredRow["prediction"]) {
  if (x === "Yes") return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300";
  if (x === "No") return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
  if (x === "Neutral") return "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300";
  return "bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/20 dark:text-zinc-400";
}

function outcomePillClasses(outcome: TaPredRow["outcome"]) {
  if (outcome === "Yes") return predPillClasses("Yes");
  if (outcome === "No") return predPillClasses("No");
  return "bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/20 dark:text-zinc-400";
}

function fmtEtHm(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function fmtEtRange(startTsSec: number, endTsSec: number) {
  return `${fmtEtHm(startTsSec)}–${fmtEtHm(endTsSec)} ET`;
}

export default function TaPredictionTable(props: { rows: TaPredRow[] }) {
  const { rows } = props;

  return (
    <section className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
      <div className="bg-white px-4 py-3 text-sm font-medium text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
        TA Predictions (per slug)
        <span className="ml-2 text-xs font-normal text-zinc-500">Last {rows.length} slugs</span>
      </div>

      <div className="overflow-x-auto bg-white dark:bg-zinc-950">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr className="border-b border-zinc-200 dark:border-zinc-900">
              <th className="px-4 py-3">Slug window (ET)</th>
              <th className="px-4 py-3">TA prediction</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Slug</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-zinc-500" colSpan={5}>
                  Loading TA prediction rows...
                </td>
              </tr>
            ) : null}

            {rows.map((r) => {
              const resolved = r.outcome === "Yes" || r.outcome === "No";
              const predKnown = r.prediction === "Yes" || r.prediction === "No";
              const isHit = resolved && predKnown ? r.prediction === r.outcome : null;

              return (
                <tr key={`${r.slug}-${r.startTsSec}`} className="border-b border-zinc-200/70 dark:border-zinc-900/70">
                  <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-200">{fmtEtRange(r.startTsSec, r.endTsSec)}</td>

                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${predPillClasses(r.prediction)}`}>
                      {r.prediction ?? "—"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${outcomePillClasses(r.outcome)}`}>
                      {r.outcome === "Open" ? "Pending..." : r.outcome}
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

                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{r.slug}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
