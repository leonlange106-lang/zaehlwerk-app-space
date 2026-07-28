// Browser-safe surface of this package: no Prisma client import, no Node
// built-ins. This is the SERVER-side barrel — it pulls in Zod via `schemas`,
// `auth` and `backup`, and because this package is CommonJS that cost cannot be
// tree-shaken away by a consumer. Client components must import
// `@zaehlwerk/database/client` (zod-free) instead; see `client.ts`.
// The main `@zaehlwerk/database` entry re-exports this too, for server code.
// (`./auth` re-exports ./roles — a second star-export of the same names here
// would make them ambiguous and silently drop them.)
export * from "./categories";
export * from "./schemas";
export * from "./consumption";
export * from "./gas";
export * from "./obis";
export * from "./tariff";
export * from "./projection";
export * from "./backup";
export * from "./auth";
