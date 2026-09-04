import { clsx } from "clsx";
import { Package, Timer, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { DetectionStats } from "@/types/detection";

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  accent: string;
  iconBg: string;
  active: boolean;
}

function StatTile({ label, value, unit, icon, accent, iconBg, active }: StatTileProps) {
  return (
    <Card className="group relative px-5 py-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div
        className={clsx(
          "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl transition-opacity duration-300",
          accent,
          active ? "opacity-30" : "opacity-10"
        )}
      />
      <div className="relative flex items-center gap-4">
        <div
          className={clsx(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/10",
            iconBg
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1 font-mono">
            <span
              className={clsx(
                "text-2xl font-bold tabular-nums transition-colors",
                active ? "text-slate-50" : "text-slate-600"
              )}
            >
              {value}
            </span>
            {unit && <span className="text-xs text-slate-500">{unit}</span>}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function StatsPanel({ stats }: { stats: DetectionStats | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatTile
        label="Total Bags Detected"
        value={stats ? stats.bagCount.toLocaleString() : "--"}
        icon={<Package className="h-5 w-5 text-emerald-300" />}
        accent="bg-emerald-500/40"
        iconBg="bg-emerald-500/10"
        active={Boolean(stats)}
      />
      <StatTile
        label="Processing Time"
        value={stats ? stats.latencyMs.toFixed(1) : "--"}
        unit="ms"
        icon={<Timer className="h-5 w-5 text-cyan-300" />}
        accent="bg-cyan-500/40"
        iconBg="bg-cyan-500/10"
        active={Boolean(stats)}
      />
      <StatTile
        label="Confidence Score Avg"
        value={stats ? (stats.confidenceAvg * 100).toFixed(1) : "--"}
        unit="%"
        icon={<Gauge className="h-5 w-5 text-violet-300" />}
        accent="bg-violet-500/40"
        iconBg="bg-violet-500/10"
        active={Boolean(stats)}
      />
    </div>
  );
}
