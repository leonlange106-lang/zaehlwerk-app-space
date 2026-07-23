import { Suspense } from "react";
import { TwoFactorForm } from "./TwoFactorForm";

export const dynamic = "force-dynamic";

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
