import { Suspense } from "react";
import { redirect } from "next/navigation";
import { userCount } from "../lib/auth-helpers";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // No users yet → send to first-boot setup instead of an unusable login.
  if ((await userCount()) === 0) {
    redirect("/setup");
  }
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
