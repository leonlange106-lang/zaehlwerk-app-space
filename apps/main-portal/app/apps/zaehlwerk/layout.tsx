import { requireAppAccess } from "@/app/lib/app-access";

export const dynamic = "force-dynamic";

// Gate the whole Zählwerk subtree: users without the "zaehlwerk" app assigned
// are redirected to the launcher (admins always pass).
export default async function ZaehlwerkAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAppAccess("zaehlwerk");
  return <>{children}</>;
}
