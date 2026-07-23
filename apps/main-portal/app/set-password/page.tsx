import { redirect } from "next/navigation";
import { getSessionUser } from "../lib/auth-helpers";
import { prisma } from "@zaehlwerk/database";
import { SetPasswordForm } from "./SetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Passwort festlegen – App Space",
};

// Forced password setup for temp-password accounts. The middleware already
// redirects such users here; this page additionally reads the DB as the
// authoritative source (the JWT flag could be stale) and bounces anyone who
// doesn't actually need it.
export default async function SetPasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mustSetPassword: true },
  });
  if (!row?.mustSetPassword) redirect("/");

  return <SetPasswordForm email={user.email} />;
}
