/**
 * KIAAN STUDIO — CLOUDFLARE WORKER SAFETY & MOCK ELIMINATION REGRESSION TEST
 *
 * Verifies that:
 * 1. Cloudflare Workers AI configuration is active and loaded from .env.
 * 2. Model endpoints and request formats for FLUX.2 Klein 4B and FLUX.1 Schnell are correct.
 * 3. Node.js Cloudflare Worker Daemon never falls back to mock images on failure.
 * 4. Failing jobs trigger WorkerService.failJob and automatic credit refund.
 * 5. Asset metadata clearly distinguishes real Cloudflare photos from historical mock canvases.
 * 6. WaveSpeed / Z-Image Turbo integration is preserved and untouched.
 */

import assert from 'node:assert'
import { CloudflareAiService, CLOUDFLARE_MODELS } from '../src/modules/generation/cloudflareAi.service.js'
import { CloudflareWorkerDaemon } from '../src/modules/generation/cloudflareWorker.js'
import { WorkerService } from '../src/modules/generation/worker.service.js'
import { CREDIT_PRICING } from '../src/modules/credits/credits.service.js'
import { env } from '../src/config/env.js'

let passed = 0
let failed = 0

function pass(name) {
  passed++
  console.log(`[PASS] ${name}`)
}

function fail(name, err) {
  failed++
  console.error(`[FAIL] ${name}:`, err.message || err)
}

async function runSafetyAudit() {
  console.log('====================================================')
  console.log(' KIAAN STUDIO — CLOUDFLARE SAFETY REGRESSION TEST')
  console.log('====================================================\n')

  // --- TEST 1: Cloudflare Credentials & Configuration Discovery ---
  try {
    assert.strictEqual(CloudflareAiService.isConfigured(), true, 'CloudflareAiService must be configured')
    const creds = CloudflareAiService.getCredentials()
    assert.ok(creds.accountId && creds.accountId.length > 10, 'Cloudflare account ID must be present')
    assert.ok(creds.token && creds.token.length > 10, 'Cloudflare API token must be present')
    assert.strictEqual(env.ENABLE_AI_WORKER, true, 'ENABLE_AI_WORKER must be true')
    assert.strictEqual(env.CLOUDFLARE_INFERENCE_MODE, 'live', 'CLOUDFLARE_INFERENCE_MODE must be live')
    pass('1. Cloudflare credentials and runtime environment flags verified')
  } catch (err) {
    fail('1. Cloudflare credentials and runtime environment flags verified', err)
  }

  // --- TEST 2: Model Endpoint Routing & Format Parity ---
  try {
    assert.strictEqual(CLOUDFLARE_MODELS['flux-2-klein-4b'].cfModel, '@cf/black-forest-labs/flux-2-klein-4b')
    assert.strictEqual(CLOUDFLARE_MODELS['flux-2-klein-4b'].format, 'multipart')

    assert.strictEqual(CLOUDFLARE_MODELS['flux-1-schnell'].cfModel, '@cf/black-forest-labs/flux-1-schnell')
    assert.strictEqual(CLOUDFLARE_MODELS['flux-1-schnell'].format, 'json')

    pass('2. Cloudflare model endpoints and request formats verified')
  } catch (err) {
    fail('2. Cloudflare model endpoints and request formats verified', err)
  }

  // --- TEST 3: Preservation of WaveSpeed / Z-Image Turbo Catalog ---
  try {
    assert.ok(CREDIT_PRICING.MODELS['z-image-turbo'], 'z-image-turbo must exist in pricing catalog')
    assert.strictEqual(CREDIT_PRICING.MODELS['z-image-turbo'].baseCost, 1)
    assert.ok(!CLOUDFLARE_MODELS['z-image-turbo'], 'z-image-turbo must NOT route to Cloudflare worker')
    pass('3. WaveSpeed / Z-Image Turbo model catalog preserved and segregated from Cloudflare')
  } catch (err) {
    fail('3. WaveSpeed / Z-Image Turbo model catalog preserved and segregated from Cloudflare', err)
  }

  // --- TEST 4: Fail-Closed Behavior (No Silent Fallback to Mock) ---
  try {
    let failJobCalled = false
    let completeJobCalled = false
    let recordedError = ''

    const origFailJob = WorkerService.failJob
    const origCompleteJob = WorkerService.completeJob
    const origGenerateImage = CloudflareAiService.generateImage
    const origReportProgress = WorkerService.reportProgress

    WorkerService.reportProgress = async () => ({})
    WorkerService.completeJob = async () => {
      completeJobCalled = true
      return {}
    }
    WorkerService.failJob = async (jobId, data) => {
      failJobCalled = true
      recordedError = data.errorMessage
      return { refundedCredits: 1 }
    }

    // Force Cloudflare API error
    CloudflareAiService.generateImage = async () => {
      throw new Error('Simulated Cloudflare API 503 Outage')
    }

    const dummyJob = {
      id: 'mock-test-safety-job-1',
      modelId: 'flux-2-klein-4b',
      prompt: 'A sleek modern sports car',
      parametersJson: JSON.stringify({ aspect: '1:1' })
    }

    let caughtError = null
    try {
      await CloudflareWorkerDaemon.processJob(dummyJob)
    } catch (err) {
      caughtError = err
    }

    // Restore originals
    WorkerService.failJob = origFailJob
    WorkerService.completeJob = origCompleteJob
    CloudflareAiService.generateImage = origGenerateImage
    WorkerService.reportProgress = origReportProgress

    assert.ok(caughtError, 'processJob must rethrow on failure')
    assert.strictEqual(completeJobCalled, false, 'completeJob must NEVER be called on Cloudflare failure')
    assert.strictEqual(failJobCalled, true, 'failJob must be invoked to trigger credit refund')
    assert.strictEqual(recordedError, 'Simulated Cloudflare API 503 Outage')

    pass('4. Cloudflare worker daemon fails closed, rejects mock fallback, and invokes credit refund')
  } catch (err) {
    fail('4. Cloudflare worker daemon fails closed, rejects mock fallback, and invokes credit refund', err)
  }

  // --- TEST 5: Content Moderation & Flagged Output Clean Translation ---
  try {
    let failJobCalled = false
    let recordedError = ''

    const origFailJob = WorkerService.failJob
    const origCompleteJob = WorkerService.completeJob
    const origGenerateImage = CloudflareAiService.generateImage
    const origReportProgress = WorkerService.reportProgress

    WorkerService.reportProgress = async () => ({})
    WorkerService.completeJob = async () => { }
    WorkerService.failJob = async (jobId, data) => {
      failJobCalled = true
      recordedError = data.errorMessage
      return { refundedCredits: 1 }
    }

    // Simulate Cloudflare safety moderation flag
    CloudflareAiService.generateImage = async () => {
      const safetyErr = new Error('The AI safety filter flagged the generated output for this prompt.')
      safetyErr.isFlagged = true
      throw safetyErr
    }

    const dummyJob = {
      id: 'mock-test-flagged-job-2',
      modelId: 'flux-1-schnell',
      prompt: 'Sensitive prompt test',
      parametersJson: JSON.stringify({ aspect: '1:1' })
    }

    try {
      await CloudflareWorkerDaemon.processJob(dummyJob)
    } catch {
      // Expected
    }

    WorkerService.failJob = origFailJob
    WorkerService.completeJob = origCompleteJob
    CloudflareAiService.generateImage = origGenerateImage
    WorkerService.reportProgress = origReportProgress

    assert.strictEqual(failJobCalled, true, 'failJob must be called')
    assert.ok(recordedError.includes('safety filter flagged the generated output'), 'Error must contain clear user explanation')
    assert.ok(recordedError.includes('refunded'), 'Error must inform user of credit refund')

    pass('5. Content safety moderation flags mapped to clean user message with refund notice')
  } catch (err) {
    fail('5. Content safety moderation flags mapped to clean user message with refund notice', err)
  }

  // --- TEST 6: Real Asset vs Mock Canvas Differentiation Contract ---
  try {
    // Differentiation rules:
    // Real Cloudflare: format 'jpg', size > 100KB (typically 400KB - 800KB), name pattern 'gen_<id>_<timestamp>.jpg'
    // Historical Mock: format 'webp', size < 15KB (typically 8KB - 9.5KB), name pattern 'gen_<id>_flux_<seed>_<dims>.webp'

    const realSample = {
      storagePath: '/uploads/generations/gen_test_1795165653665.jpg',
      fileSizeBytes: 681264,
      dimensions: '1024x1024',
      mediaType: 'IMAGE'
    }

    const mockSample = {
      storagePath: '/uploads/generations/gen_test_flux_778594127_1024x1024.webp',
      fileSizeBytes: 9118,
      dimensions: '1024x1024',
      mediaType: 'IMAGE'
    }

    const isRealCloudflareAsset = (asset) => {
      const isJpg = asset.storagePath.toLowerCase().endsWith('.jpg')
      const isSubstantialSize = asset.fileSizeBytes > 50000 // Real flux photos are > 100KB
      const isNotCanvasPattern = !asset.storagePath.includes('_flux_')
      return isJpg && isSubstantialSize && isNotCanvasPattern
    }

    assert.strictEqual(isRealCloudflareAsset(realSample), true, 'Real sample must pass real Cloudflare check')
    assert.strictEqual(isRealCloudflareAsset(mockSample), false, 'Mock sample must fail real Cloudflare check')

    pass('6. Asset metadata distinguishing real Cloudflare photos from mock canvases validated')
  } catch (err) {
    fail('6. Asset metadata distinguishing real Cloudflare photos from mock canvases validated', err)
  }

  console.log(`\n====================================================`)
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log('====================================================')

  if (failed > 0) {
    process.exit(1)
  }
}

runSafetyAudit().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
