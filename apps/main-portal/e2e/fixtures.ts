// Shared, side-effect-free E2E constants. Kept separate from seed.ts so specs
// can import the admin credentials without triggering the seeding routine.
export const E2E_ADMIN = { email: "admin@e2e.test", password: "E2e-Passw0rd!" };

// A non-admin user with NO apps assigned — exercises the app-access gating.
export const E2E_RESTRICTED = { email: "restricted@e2e.test", password: "E2e-Passw0rd!" };

// Temp-password accounts (mustSetPassword) — exercise the passwordless first
// login + forced password setup. First login is one-shot (it sets the
// password), so we seed a SEPARATE account per Playwright project: both mobile
// engines share one DB and run sequentially, and each must start fresh.
export const E2E_FIRSTLOGIN_PROJECTS = ["Mobile Chrome", "Mobile Safari"];
export const E2E_FIRSTLOGIN_PASSWORD = "E2e-FreshPw1!";
export function firstLoginEmail(project: string): string {
  return `firstlogin-${project.toLowerCase().replace(/\s+/g, "-")}@e2e.test`;
}

export const E2E_METER_NAME = "E2E Stromzähler";

// Marker text rendered by app/error.tsx — asserting its absence proves a page
// rendered rather than falling into the route error boundary (500).
export const ERROR_BOUNDARY_TEXT = "Etwas ist schiefgelaufen";

// Routes exercised by the "no horizontal overflow" sweep (all reachable without
// a specific id). The meter-detail route is covered separately via navigation.
export const CORE_ROUTES = [
  "/",
  "/apps/zaehlwerk",
  "/apps/zaehlwerk/zaehler",
  "/apps/zaehlwerk/berichte",
  "/apps/zaehlwerk/einstellungen",
  "/apps/log-analyzer",
  "/apps/log-analyzer/compare",
  "/apps/log-analyzer/dyno",
  "/apps/log-analyzer/remote",
  "/apps/log-analyzer/specs",
  "/apps/log-analyzer/history",
  "/settings",
  // Each settings group is its own route since the stack was split — and each is
  // a page a phone has to render without scrolling sideways.
  "/settings/sicherheit",
  "/settings/benutzer",
  "/settings/integrationen",
  "/settings/daten",
  "/settings/system",
  "/changelog",
];
