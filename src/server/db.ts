import { PrismaClient } from "@prisma/client";

// Keep local development and tests runnable before a developer creates an
// environment file. Production deployments should provide DATABASE_URL.
process.env.DATABASE_URL ??= "file:./dev.db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
