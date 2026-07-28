// Browser barrel — the surface client components should import, as
// `@zaehlwerk/database/client`.
//
// The distinction from `shared.ts` is Zod, not Prisma: `shared.ts` re-exports
// `schemas`, `auth` and `backup`, all of which import Zod. Because this package
// compiles to CommonJS, webpack cannot tree-shake through the resulting
// `__exportStar` barrel, so importing a single constant from `shared` pulled the
// whole Zod runtime into the client bundle on every route.
//
// Everything below is pure TypeScript with no dependencies. Anything that needs
// a Zod schema in the browser must import it explicitly and knowingly — the cost
// is then confined to the route that actually does so.
export * from "./categories";
export * from "./roles";
export * from "./consumption";
export * from "./gas";
export * from "./tariff";
export * from "./projection";
export * from "./obis";
export * from "./registers";
