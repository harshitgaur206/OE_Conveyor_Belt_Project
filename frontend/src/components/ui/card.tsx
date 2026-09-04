import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "glow-border relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_50px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={clsx(
        "text-xs font-semibold uppercase tracking-[0.14em] text-slate-300",
        className
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("p-4", className)} {...props} />;
}
