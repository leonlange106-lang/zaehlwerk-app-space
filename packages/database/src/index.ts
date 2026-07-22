// Server-only entry point (imports the Prisma client, which needs Node
// built-ins). Client components must import `@zaehlwerk/database/shared`
// instead — see that file for why.
import { PrismaClient } from "../generated/client/index.js";

export * from "../generated/client/index.js";
export * from "./shared";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
