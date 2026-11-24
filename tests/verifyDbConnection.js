import { prisma } from '../src/config/database.js'

async function verifyDb() {
  try {
    console.log('[DB Test] Attempting connection via Prisma Client...')
    await prisma.$connect()
    console.log('[DB Test] Prisma $connect() succeeded!')

    const info = await prisma.$queryRaw`SELECT DATABASE() as db, CURRENT_USER() as user, VERSION() as version`
    console.log('[DB Test] Connection details:', JSON.stringify(info))

    const dbCheck = await prisma.$queryRaw`SHOW DATABASES LIKE 'kiaan_studio_db'`
    console.log('[DB Test] Database existence check:', JSON.stringify(dbCheck))

    const tables = await prisma.$queryRaw`SHOW TABLES`
    console.log('[DB Test] Tables found in kiaan_studio_db:', JSON.stringify(tables))

    console.log('[DB Test] ALL READ-ONLY DB VERIFICATIONS PASSED!')
  } catch (error) {
    console.error('[DB Test] Connection verification error:', error.message)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
    console.log('[DB Test] Prisma disconnected cleanly.')
  }
}

verifyDb()
