import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

type Tone = "accent" | "amber" | "red" | "slate";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  accent: "bg-accent/10 text-accent ring-accent/25",
  amber: "bg-amber-400/10 text-amber-600 ring-amber-400/30",
  red: "bg-red-400/10 text-red-500 ring-red-400/30",
  slate: "bg-text-faint/10 text-text-muted ring-text-faint/25",
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
