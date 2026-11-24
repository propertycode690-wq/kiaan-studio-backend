import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

/**
 * Global Prisma Client singleton.
 * Configured with structured query logging in development mode.
 */
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'error' },
          { emit: 'stdout', level: 'warn' }
        ]
      : [{ emit: 'stdout', level: 'error' }]
  })
}

const globalForPrisma = globalThis

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma
}

export default prisma
