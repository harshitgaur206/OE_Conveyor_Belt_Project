import { type ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-contrast font-semibold shadow-[0_4px_16px_-4px_var(--shadow-ambient)] hover:brightness-110 disabled:bg-bg-subtle disabled:text-text-faint disabled:shadow-none",
  secondary:
    "bg-bg-subtle text-text border border-border hover:border-border-strong disabled:text-text-faint",
  outline:
    "border border-border text-text-muted hover:border-accent/50 hover:text-accent hover:bg-accent/5 disabled:text-text-faint disabled:border-border",
  ghost: "text-text-muted hover:text-text hover:bg-bg-subtle disabled:text-text-faint",
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
