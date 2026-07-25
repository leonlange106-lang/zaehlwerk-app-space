import type { ReactNode } from "react";
import { IconChip } from "./primitives";

// The frame every credential screen shares: login, first-boot setup, forced
// password change, 2FA challenge.
//
// One component rather than a copied card per screen — these four differ only in
// their heading and their fields, and when they drift the product starts feeling
// like four different products at the exact moment a user is deciding whether to
// trust it.
//
// These screens render without the app chrome (see BARE_PATHS in PortalShell),
// so the frame carries its own centring and its own ambient wash.

export function AuthShell({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-10">
      {/* Ambient accent wash — the one decorative element in the product, and it
          is here because an otherwise empty screen has nothing else to look at. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--zw-accent) 16%, transparent), transparent 70%)",
        }}
      />
      <div className="panel relative w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <IconChip size={48}>{icon}</IconChip>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-dim">{description}</p>}
          </div>
        </div>
        {children}
        {footer && <div className="mt-5 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
