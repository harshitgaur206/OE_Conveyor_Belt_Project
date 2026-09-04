import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

type Tone = "emerald" | "amber" | "red" | "slate" | "cyan";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  emerald: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
  red: "bg-red-400/10 text-red-300 ring-red-400/30",
  cyan: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30",
  slate: "bg-slate-500/10 text-slate-300 ring-slate-500/30",
};

export function Badge({ className, tone = "slate", ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ring-1 ring-inset",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}
