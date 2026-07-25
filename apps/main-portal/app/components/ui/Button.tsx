import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/app/lib/cn";

// The one button in the design language, in three weights.
//
// `primary` is the accent gradient and is deliberately scarce: one per view, on
// the action that view exists for. `subtle` is the workhorse — a glass chip that
// reads as pressable without competing. `ghost` is for dense rows and toolbars,
// where a filled control per row would be noise.
//
// Rendered as <button> or, via `ButtonLink`, as a Next <Link>: same geometry, so
// a navigation and an action sitting next to each other line up.

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap " +
    "transition-[background,box-shadow,transform,color] duration-150 " +
    "disabled:pointer-events-none disabled:opacity-45 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "accent-gradient text-white shadow-panel hover:brightness-110 active:brightness-95",
        subtle:
          "border border-line bg-elevated text-ink hover:border-line-strong hover:bg-surface",
        ghost: "text-dim hover:bg-elevated hover:text-ink",
        danger:
          "border border-transparent text-risk hover:bg-[color-mix(in_srgb,var(--zw-risk)_14%,transparent)]",
      },
      size: {
        // 44px thumb area on phones — WCAG 2.5.5 — compact from `sm` up.
        sm: "min-h-11 px-3 text-[13px] sm:min-h-8",
        md: "min-h-11 px-4 text-sm sm:min-h-10",
        lg: "min-h-12 px-5 text-[15px]",
      },
      full: { true: "w-full", false: "" },
      align: { center: "justify-center", start: "justify-start", between: "justify-between" },
    },
    defaultVariants: { variant: "subtle", size: "md", full: false, align: "center" },
  },
);

type ButtonVariants = VariantProps<typeof button>;

export interface ButtonProps extends Omit<ComponentProps<"button">, "className">, ButtonVariants {
  className?: string;
  children?: ReactNode;
}

export function Button({ variant, size, full, align, className, ...rest }: ButtonProps) {
  return <button {...rest} className={cn(button({ variant, size, full, align }), className)} />;
}

export interface ButtonLinkProps
  extends Omit<ComponentProps<typeof Link>, "className">,
    ButtonVariants {
  className?: string;
}

/** Same geometry as {@link Button}, but it navigates. */
export function ButtonLink({ variant, size, full, align, className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={cn(button({ variant, size, full, align }), className)} />;
}
