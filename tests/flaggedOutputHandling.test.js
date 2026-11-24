/**
 * KIAAN STUDIO — TARGETED FLAGGED OUTPUT & CREDIT REFUND TEST SUITE
 *
 * Tests:
 * 1. Aspect ratio parsing preservation (16:9, 1:1, 9:16)
 * 2. Cloudflare flagged output interception (HTTP 400 AiError flagged message)
 * 3. Graceful error message sanitization (no internal UUIDs or credentials exposed)
 * 4. Job status transitioned to FAILED and credits refunded exactly once
 * 5. Idempotent refund guard (cannot double-refund a failed job)
 */

import assert from 'node:assert'
import { prisma } from '../src/config/database.js'
import { GenerationService } from '../src/modules/generation/generation.service.js'
import { WorkerService } from '../src/modules/generation/worker.service.js'
import { CreditsService } from '../src/modules/credits/credits.service.js'
import { CloudflareAiService } from '../src/modules/generation/cloudflareAi.service.js'
import { CloudflareWorkerDaemon } from '../src/modules/generation/cloudflareWorker.js'

console.log('====================================================')
console.log(' KIAAN STUDIO — FLAGGED OUTPUT & REFUND TEST SUITE')
console.log('====================================================\n')

let passCount = 0
let failCount = 0

function pass(name) {
  passCount++
  console.log(`[PASS] ${name}`)
}

function fail(name, err) {
  failCount++
  console.error(`[FAIL] ${name}:`, err?.message || err)
}

async function runTests() {
  const testUser = await prisma.user.findFirst({
    where: { role: 'CREATOR' }
  })
  if (!testUser) throw new Error('No test user found')
  const userId = testUser.id

  // --- Test 1: Dimension & Aspect Ratio Preservation ---
  try {
    const dim1_1 = CloudflareAiService.parseDimensions('1:1')
    assert.strictEqual(dim1_1.width, 1024)
    assert.strictEqual(dim1_1.height, 1024)

    // Ensure 16:9 is not warped by raw width clamping
    const dim16_9 = CloudflareAiService.parseDimensions('16:9', 1344, 768)
    assert.strictEqual(dim16_9.width, 1024)
    assert.strictEqual(dim16_9.height, 576)

    const dim9_16 = CloudflareAiService.parseDimensions('9:16', 768, 1344)
    assert.strictEqual(dim9_16.width, 576)
    assert.strictEqual(dim9_16.height, 1024)

    pass('1. Aspect ratio dimension preservation verified (1:1, 16:9, 9:16)')
  } catch (err) {
    fail('1. Aspect ratio dimension preservation verified', err)
  }

  // --- Test 2: Interception of Flagged Output Error ---
  try {
    const originalFetch = globalThis.fetch
    try {
      // Mock Cloudflare returning the exact HTTP 400 moderation response
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 400,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            errors: [
              {
                code: 3030,
                message: 'AiError: Your output has been flagged. Please choose another prompt / input image combination (mock-request-id-12345)'
              }
            ],
            messages: [],
            result: null,
            success: false
          })
        }
      }

      let thrownErr = null
      try {
        await CloudflareAiService.generateImage({
          modelId: 'flux-2-klein-4b',
          prompt: 'A prompt that triggers output moderation',
          parameters: { aspect: '1:1' },
          jobId: 'mock-flagged-job'
        })
      } catch (err) {
        thrownErr = err
      }

      assert.ok(thrownErr, 'Should throw an error for flagged output')
      assert.strictEqual(thrownErr.isFlagged, true, 'isFlagged property must be true')
      assert.strictEqual(thrownErr.code, 'CONTENT_OUTPUT_FLAGGED')
      assert.match(thrownErr.message, /AI safety filter flagged the generated output/i)
      // Ensure no raw internal tokens or internal IDs leaked
      assert.doesNotMatch(thrownErr.message, /mock-request-id-12345/)

      pass('2. Cloudflare flagged output intercepted and classified as CONTENT_OUTPUT_FLAGGED')
    } finally {
      globalThis.fetch = originalFetch
    }
  } catch (err) {
    fail('2. Cloudflare flagged output intercepted', err)
  }

  // --- Test 3: Worker Processing, User Guidance & Safe Logging ---
  try {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 400,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            errors: [
              {
                code: 3030,
                message: 'AiError: Your output has been flagged. Please choose another prompt / input image combination (request-token-abc)'
              }
            ],
            success: false
          })
        }
      }

      const walletBefore = await CreditsService.getBalance(userId)

      // Submit job via service
      const job = await GenerationService.createJob(userId, {
        type: 'TEXT_TO_IMAGE',
        modelId: 'flux-2-klein-4b',
        prompt: 'Luxury car prompt with sensitive latents',
        parameters: { aspect: '1:1' }
      })

      const walletDuring = await CreditsService.getBalance(userId)
      assert.strictEqual(walletDuring.reservedBalance, walletBefore.reservedBalance + 1, '1 credit reserved')

      // Process with worker (triggers failure handling)
      let caught = null
      try {
        await CloudflareWorkerDaemon.processJob(job)
      } catch (e) {
        caught = e
      }

      assert.ok(caught, 'processJob should propagate failure')

      // Inspect updated job record in DB
      const updatedJob = await prisma.generationJob.findUnique({
        where: { id: job.id }
      })

      assert.strictEqual(updatedJob.status, 'FAILED')
      assert.match(updatedJob.errorMessage, /AI safety filter flagged the generated output/i)
      assert.match(updatedJob.errorMessage, /credits have been fully refunded/i)
      assert.doesNotMatch(updatedJob.errorMessage, /request-token-abc/, 'Safe error messaging without provider tokens')

      // Verify wallet restored
      const walletAfter = await CreditsService.getBalance(userId)
      assert.strictEqual(walletAfter.reservedBalance, walletBefore.reservedBalance, 'Reserved balance fully cleared')
      assert.strictEqual(walletAfter.balance, walletBefore.balance, 'Available balance fully restored')

      pass('3. Worker records safe user guidance and executes single atomic credit refund')
    } finally {
      globalThis.fetch = originalFetch
    }
  } catch (err) {
    fail('3. Worker records safe user guidance and executes single atomic credit refund', err)
  }

  // --- Test 4: Idempotency of Credit Refund ---
  try {
    const walletBefore = await CreditsService.getBalance(userId)

    const job = await GenerationService.createJob(userId, {
      type: 'TEXT_TO_IMAGE',
      modelId: 'flux-2-klein-4b',
      prompt: 'Testing refund idempotency',
      parameters: { aspect: '1:1' }
    })

    // First failure
    await WorkerService.failJob(job.id, {
      workerNodeId: 'test-node',
      errorMessage: 'First failure report'
    })

    const walletAfterFirst = await CreditsService.getBalance(userId)
    assert.strictEqual(walletAfterFirst.balance, walletBefore.balance, 'Credits restored after first fail')

    // Second redundant failure call (should be safe no-op for credits)
    await WorkerService.failJob(job.id, {
      workerNodeId: 'test-node',
      errorMessage: 'Duplicate failure report'
    })

    const walletAfterSecond = await CreditsService.getBalance(userId)
    assert.strictEqual(walletAfterSecond.balance, walletBefore.balance, 'Balance unchanged after duplicate failJob')

    pass('4. Credit refund idempotency verified (zero double-refunds or double-deductions)')
  } catch (err) {
    fail('4. Credit refund idempotency verified', err)
  }

  console.log('\n====================================================')
  console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED`)
  console.log('====================================================\n')

  await prisma.$disconnect()
  process.exit(failCount > 0 ? 1 : 0)
}

runTests().catch((err) => {
  console.error('[FATAL ERROR]', err)
  process.exit(1)
})
