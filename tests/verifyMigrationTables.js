import { prisma } from '../src/config/database.js'

async function verifyAllModels() {
  console.log('=== VERIFYING ALL 18 PRISMA MODELS IN KIAAN_STUDIO_DB ===')
  
  const models = [
    { name: 'user', fn: () => prisma.user.findMany() },
    { name: 'refreshToken', fn: () => prisma.refreshToken.findMany() },
    { name: 'apiKey', fn: () => prisma.apiKey.findMany() },
    { name: 'creditWallet', fn: () => prisma.creditWallet.findMany() },
    { name: 'creditTransaction', fn: () => prisma.creditTransaction.findMany() },
    { name: 'subscriptionPlan', fn: () => prisma.subscriptionPlan.findMany() },
    { name: 'subscription', fn: () => prisma.subscription.findMany() },
    { name: 'invoice', fn: () => prisma.invoice.findMany() },
    { name: 'generationJob', fn: () => prisma.generationJob.findMany() },
    { name: 'generatedAsset', fn: () => prisma.generatedAsset.findMany() },
    { name: 'project', fn: () => prisma.project.findMany() },
    { name: 'downloadRecord', fn: () => prisma.downloadRecord.findMany() },
    { name: 'aiModel', fn: () => prisma.aiModel.findMany() },
    { name: 'gpuNode', fn: () => prisma.gpuNode.findMany() },
    { name: 'supportTicket', fn: () => prisma.supportTicket.findMany() },
    { name: 'ticketMessage', fn: () => prisma.ticketMessage.findMany() },
    { name: 'auditLog', fn: () => prisma.auditLog.findMany() },
    { name: 'systemSetting', fn: () => prisma.systemSetting.findMany() }
  ]

  let successCount = 0

  for (const m of models) {
    try {
      const result = await m.fn()
      console.log(`[PASS] Model: ${m.name.padEnd(20)} -> Table exists and returns array (count: ${result.length})`)
      successCount++
    } catch (err) {
      console.error(`[FAIL] Model: ${m.name} -> Error: ${err.message}`)
    }
  }

  console.log(`\nVerified ${successCount} / ${models.length} models successfully!`)
  
  // Inspect Foreign Keys & Constraints
  const fkQuery = await prisma.$queryRaw`
    SELECT 
      TABLE_NAME, 
      COLUMN_NAME, 
      CONSTRAINT_NAME, 
      REFERENCED_TABLE_NAME, 
      REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'kiaan_studio_db' AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME
  `
  console.log(`\n=== FOREIGN KEYS IN KIAAN_STUDIO_DB (${fkQuery.length} foreign keys found) ===`)
  fkQuery.forEach(fk => {
    console.log(`  ${fk.TABLE_NAME}.${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME} (${fk.CONSTRAINT_NAME})`)
  })

  // Inspect Indexes
  const idxQuery = await prisma.$queryRaw`
    SELECT 
      TABLE_NAME, 
      INDEX_NAME, 
      NON_UNIQUE, 
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as COLUMNS
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'kiaan_studio_db'
    GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
    ORDER BY TABLE_NAME, INDEX_NAME
  `
  console.log(`\n=== INDEXES IN KIAAN_STUDIO_DB (${idxQuery.length} indexes found) ===`)
  idxQuery.forEach(idx => {
    const type = idx.INDEX_NAME === 'PRIMARY' ? '[PRIMARY]' : idx.NON_UNIQUE == 0 ? '[UNIQUE]' : '[INDEX]'
    console.log(`  ${idx.TABLE_NAME} ${type} ${idx.INDEX_NAME} (${idx.COLUMNS})`)
  })

  await prisma.$disconnect()
}

verifyAllModels()
