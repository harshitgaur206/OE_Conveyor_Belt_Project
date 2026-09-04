import { type ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "relative bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold shadow-[0_0_24px_-6px_rgba(16,185,129,0.7)] hover:shadow-[0_0_30px_-4px_rgba(34,211,238,0.8)] hover:brightness-110 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none",
  secondary:
    "bg-slate-800/80 text-slate-100 border border-white/10 hover:bg-slate-700/80 disabled:bg-slate-900 disabled:text-slate-600",
  outline:
    "border border-white/15 text-slate-200 hover:border-cyan-400/50 hover:text-cyan-300 hover:bg-cyan-400/5 disabled:text-slate-600 disabled:border-slate-800",
  ghost: "text-slate-400 hover:text-slate-100 hover:bg-white/5 disabled:text-slate-700",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium tracking-wide transition-all duration-200 disabled:cursor-not-allowed",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
