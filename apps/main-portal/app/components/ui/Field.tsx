import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/app/lib/cn";

// Form controls in the design language: a recessed well on the glass plate.
//
// `Field` owns the label/description/error scaffolding and the id wiring, so a
// control is always labelled — `htmlFor` and `aria-describedby` are generated
// here rather than remembered at each call site. That is also why the control is
// a render prop: it receives the ids it must carry.

const controlBase =
  "well h-11 w-full px-3.5 text-sm outline-none transition-colors sm:h-10 " +
  "placeholder:text-dim focus:border-accent disabled:opacity-50";

export function Field({
  label,
  description,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const helpId = description || error ? `${id}-help` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {required && (
          <span className="ml-1 text-risk" aria-hidden>
            *
          </span>
        )}
      </label>
      {description && !error && (
        <p id={helpId} className="text-xs text-dim">
          {description}
        </p>
      )}
      {children({ id, describedBy: helpId })}
      {error && (
        <p id={helpId} className="text-xs text-risk">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<"input">) {
  return <input {...rest} className={cn(controlBase, className)} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select {...rest} className={cn(controlBase, "appearance-none pr-9", className)}>
      {children}
    </select>
  );
}

/** Select wrapper that draws the chevron — `appearance: none` removes the native one. */
export function SelectShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-dim"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8l4 4 4-4" />
      </svg>
    </div>
  );
}
