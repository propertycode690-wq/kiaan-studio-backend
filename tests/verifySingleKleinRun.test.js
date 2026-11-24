/**
 * KIAAN STUDIO — SINGLE TARGETED REAL FLUX.2 KLEIN 4B RUN
 *
 * Performs strictly ONE real live generation using a simple neutral prompt.
 */

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/config/database.js'
import { GenerationService } from '../src/modules/generation/generation.service.js'
import { CreditsService } from '../src/modules/credits/credits.service.js'
import { CloudflareWorkerDaemon } from '../src/modules/generation/cloudflareWorker.js'

console.log('====================================================')
console.log(' KIAAN STUDIO — TARGETED FLUX.2 REAL LIVE GENERATION')
console.log('====================================================\n')

async function runSingleKlein() {
  const testUser = await prisma.user.findFirst({
    where: { role: 'CREATOR' }
  })
  if (!testUser) throw new Error('No test user found')
  const userId = testUser.id

  const walletBefore = await CreditsService.getBalance(userId)
  console.log(`[INFO] Initial balance: ${walletBefore.balance} credits`)

  console.log('[LIVE RUN] Submitting ONE real FLUX.2 Klein 4B job with neutral prompt...')
  const job = await GenerationService.createJob(userId, {
    type: 'TEXT_TO_IMAGE',
    modelId: 'flux-2-klein-4b',
    prompt: 'A serene Japanese rock garden with raked sand, smooth granite stones and small green moss, soft morning light, calm architectural photography',
    parameters: {
      aspect: '1:1',
      width: 1024,
      height: 1024
    }
  })

  console.log(`[LIVE RUN] Job #${job.id} enqueued. Polling status...`)

  // Wait for completion (via background daemon or direct poll)
  let completed = null
  const startTime = Date.now()
  while (Date.now() - startTime < 90000) {
    const jobRecord = await prisma.generationJob.findUnique({
      where: { id: job.id },
      include: { assets: true }
    })

    if (jobRecord.status === 'COMPLETED') {
      completed = jobRecord
      break
    }
    if (jobRecord.status === 'FAILED') {
      throw new Error(`Job failed: ${jobRecord.errorMessage}`)
    }

    if (jobRecord.status === 'QUEUED') {
      await CloudflareWorkerDaemon.pollAndProcessNextJob()
    }

    await new Promise((r) => setTimeout(r, 1500))
  }

  assert.ok(completed, 'Job should complete successfully')
  assert.strictEqual(completed.status, 'COMPLETED')
  assert.strictEqual(completed.modelId, 'flux-2-klein-4b')
  assert.ok(completed.assets.length > 0, 'Asset must be generated')

  const asset = completed.assets[0]
  const diskPath = path.resolve(process.cwd(), asset.storagePath.replace(/^\//, ''))
  assert.ok(fs.existsSync(diskPath), `Asset file must exist at ${diskPath}`)
  const stat = fs.statSync(diskPath)
  assert.ok(stat.size > 10000, `Asset size should be > 10KB (got ${stat.size} bytes)`)

  const walletAfter = await CreditsService.getBalance(userId)
  assert.strictEqual(walletAfter.balance, walletBefore.balance - 1, 'Exactly 1 credit finalized')

  console.log('\n[PASS] FLUX.2 Klein 4B single real generation completed successfully!')
  console.log(`  • Asset Path : ${asset.storagePath}`)
  console.log(`  • File Size  : ${stat.size} bytes`)
  console.log(`  • Balance    : ${walletBefore.balance} -> ${walletAfter.balance} (-1 credit)`)
  console.log(`  • Dimensions : ${asset.dimensions}`)

  await prisma.$disconnect()
  process.exit(0)
}

runSingleKlein().catch(async (err) => {
  console.error('[FAIL]', err.message || err)
  await prisma.$disconnect()
  process.exit(1)
})
