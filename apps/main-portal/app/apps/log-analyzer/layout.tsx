import { requireAppAccess } from "@/app/lib/app-access";

export const dynamic = "force-dynamic";

// Gate the Log Analyzer subtree: users without the "log-analyzer" app assigned
// are redirected to the launcher (admins always pass).
export default async function LogAnalyzerAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAppAccess("log-analyzer");
  return <>{children}</>;
}
