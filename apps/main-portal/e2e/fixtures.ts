// Shared, side-effect-free E2E constants. Kept separate from seed.ts so specs
// can import the admin credentials without triggering the seeding routine.
export const E2E_ADMIN = { email: "admin@e2e.test", password: "E2e-Passw0rd!" };

// A non-admin user with NO apps assigned — exercises the app-access gating.
export const E2E_RESTRICTED = { email: "restricted@e2e.test", password: "E2e-Passw0rd!" };

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
  "/settings",
  "/changelog",
];
