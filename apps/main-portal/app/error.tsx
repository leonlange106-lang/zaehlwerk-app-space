"use client";

// Route-segment error boundary. Catches render/data errors thrown by any page
// under the root layout and shows a recoverable fallback instead of a blank
// screen. Keep the message generic — never surface raw error details (they can
// leak internals) beyond the digest, which is safe to show and is what makes a
// user's report matchable to a server log line.

import { useEffect } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "./components/ui/Button";
import { IconChip } from "./components/ui/primitives";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server/browser console for diagnostics; users only see the
    // friendly panel below.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="panel flex max-w-md flex-col items-center gap-4 p-7 text-center">
        <IconChip accent="var(--zw-risk)" size={56}>
          <IconAlertTriangle size={28} stroke={1.7} />
        </IconChip>
        <h1 className="text-lg font-semibold tracking-tight">Etwas ist schiefgelaufen</h1>
        <p className="text-sm text-dim">
          Diese Ansicht konnte nicht geladen werden. Du kannst es erneut versuchen — die übrigen
          Daten sind davon nicht betroffen.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-dim">Referenz: {error.digest}</p>
        )}
        <Button variant="primary" onClick={() => reset()}>
          <IconRefresh size={16} stroke={1.9} />
          Erneut versuchen
        </Button>
      </div>
    </div>
  );
}
