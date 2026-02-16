"use client";

import React from "react";

export type MarketEvent = {
  slug: string;
  startTsSec: number;
  endTsSec: number;

  hitSide: "Yes" | "No" | null;
  hitPrice: number | null;

  // NEW: exact second when hit occurred (epoch sec)
  hitTsSec?: number | null;

  // NEW: show source
  firstHitSource?: "kv" | "prices" | null;
  yesSamples?: number;
  noSamples?: number;

  outcome: "Yes" | "No" | "Open";
};

function fmtETRange(startTsSec: number, endTsSec: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  const a = fmt.format(new Date(startTsSec * 1000));
  const b = fmt.format(new Date(endTsSec * 1000));
  return `${a}–${b} ET`;
}

function fmtETTime(tsSec: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return fmt.format(new Date(tsSec * 1000));
}

function badge(sig: "Yes" | "No") {
  return sig === "Yes"
    ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300"
    : "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
}

export default function TaAnalysisTable({
  events,
  taAccuracy,
  totalSignals,
  onEventClick,
}: {
  events: MarketEvent[];
  taAccuracy: number;
  totalSignals: number;
  onEventClick?: (ev: MarketEvent) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
      <div className="bg-white px-4 py-3 text-sm font-medium text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>Event Log</span>
        <span className="text-xs text-zinc-500">
          TA: {taAccuracy.toFixed(1)}% ({totalSignals})
        </span>
      </div>

      <div className="overflow-x-auto bg-white dark:bg-zinc-950">
        <table className="w-full min-w-[900px] text-left text-sm">
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
            {events.map((e) => {
              const resolved = e.outcome === "Yes" || e.outcome === "No";
              const scorable = e.hitSide === "Yes" || e.hitSide === "No";
              const isHit = resolved && scorable && e.hitSide === e.outcome;
              const isMiss = resolved && scorable && e.hitSide !== e.outcome;

              return (
                <tr
                  key={e.slug}
                  className="border-b border-zinc-200/70 dark:border-zinc-900/70 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/20 cursor-pointer"
                  onClick={() => onEventClick?.(e)}
                >
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-200">
                    {fmtETRange(e.startTsSec, e.endTsSec)}
                  </td>

                  {/* Signal cell + KV/1m badge */}
                  <td className="px-4 py-3">
                    {e.hitSide ? (
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs ${badge(e.hitSide)}`}>
                          {e.hitSide}
                        </span>

                        <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
                          {e.hitPrice == null ? "-" : e.hitPrice.toFixed(3)}
                        </span>

                        {typeof e.hitTsSec === "number" ? (
                          <span className="text-xs text-zinc-500">{fmtETTime(e.hitTsSec)}</span>
                        ) : null}

                        {e.firstHitSource ? (
                          <span className="rounded-md px-1.5 py-0.5 text-[10px] ring-1 ring-zinc-200 text-zinc-600 dark:ring-zinc-800 dark:text-zinc-300">
                            {e.firstHitSource === "kv" ? "KV" : "1m"}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {resolved ? (
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs ${badge(e.outcome as "Yes" | "No")}`}>
                        {e.outcome}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full px-3 py-1 text-xs bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/20 dark:text-zinc-300">
                        Pending…
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {isHit ? (
                      <span className="text-emerald-700 dark:text-emerald-300">✓ Hit</span>
                    ) : isMiss ? (
                      <span className="text-rose-700 dark:text-rose-300">✕ Miss</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{e.slug}</td>
                </tr>
              );
            })}

            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-zinc-500">
                  No events yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
