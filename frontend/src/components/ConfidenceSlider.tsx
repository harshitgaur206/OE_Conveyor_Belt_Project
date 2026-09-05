"use client";

interface ConfidenceSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}

export const DEFAULT_CONFIDENCE = 0.45;

export function ConfidenceSlider({ value, onChange, disabled, label = "Confidence" }: ConfidenceSliderProps) {
  return (
    <div className="flex items-center gap-2.5">
      <label className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-slate-500">{label}</label>
      <input
        type="range"
        min={0.05}
        max={0.95}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-11 shrink-0 text-right font-mono text-xs font-medium text-emerald-300">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
