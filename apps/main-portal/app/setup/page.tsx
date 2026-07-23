import { redirect } from "next/navigation";
import { userCount } from "../lib/auth-helpers";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

// Zero-Config First Boot: only reachable while NO user exists yet. Once the
// initial admin is created this always bounces to the login.
export default async function SetupPage() {
  if ((await userCount()) > 0) {
    redirect("/login");
  }
  return <SetupForm />;
}
