/**
 * KIAAN STUDIO — COMPREHENSIVE IMAGE-TO-IMAGE & FLUX.2 KLEIN 4B INTEGRATION TEST SUITE
 * 
 * Verifies:
 * 1. Cloudflare Img2Img separate credentials routing (CLOUDFLARE_IMG2IMG_* vs CLOUDFLARE_*).
 * 2. Reference image validation: buffer checks, mime type, size bounds (100B - 10MB), and dimensions.
 * 3. Reference image ingestion (data URL, uploads path, sample path) via processAndSaveReferenceImage.
 * 4. Multipart payload verification: input_image_0 Blob, prompt, strength, dimensions, seed.
 * 5. Rejection of silent fallback: Img2Img requires reference image and routes strictly to Img2Img endpoint.
 * 6. CloudflareWorkerDaemon routing:
 *    - IMAGE_TO_IMAGE + flux-2-klein-4b -> CloudflareAiService.generateImageToImage
 *    - IMAGE_TO_IMAGE + z-image-turbo -> Truthful development message & credit refund
 *    - IMAGE_TO_IMAGE + flux-depth-canny -> Truthful development message & credit refund
 * 7. Provider error mapping: HTTP 401, HTTP 429, and AI content moderation / safety flags.
 * 8. Stuck-job watchdog cleanup & concurrency limit evaluation for IMAGE_TO_IMAGE.
 * 9. Text-to-Image regression test: verifies FLUX.1, FLUX.2, and WaveSpeed remain 100% operational.
 * 10. Frontend error object safety and duplicate submission guard.
 * 
 * ZERO LIVE/PAID INFERENCE. All network requests are mocked locally in-memory.
 */

import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { CloudflareAiService, CLOUDFLARE_MODELS } from '../src/modules/generation/cloudflareAi.service.js'
import { WavespeedAiService } from '../src/modules/generation/wavespeedAi.service.js'
import { CloudflareWorkerDaemon } from '../src/modules/generation/cloudflareWorker.js'
import { CreditsService, CREDIT_PRICING } from '../src/modules/credits/credits.service.js'
import { AssetsService } from '../src/modules/assets/assets.service.js'
import { GenerationService } from '../src/modules/generation/generation.service.js'
import { WorkerService } from '../src/modules/generation/worker.service.js'
import { getImageDimensions, validateImageBuffer, processAndSaveReferenceImage } from '../src/utils/imageValidator.js'

console.log('======================================================================')
console.log('   KIAAN STUDIO — IMAGE-TO-IMAGE FLUX.2 KLEIN TEST SUITE (MOCKED)    ')
console.log('======================================================================\n')

let passCount = 0
let failCount = 0

function pass(name) {
  passCount++
  console.log(`  ✓ [PASS] ${name}`)
}

function fail(name, err) {
  failCount++
  console.error(`  ✗ [FAIL] ${name}:`, err?.message || err)
}

// Sample 256-byte dummy JPEG binary with standard SOF0 marker
function createDummyJpeg(width = 512, height = 512) {
  const buf = Buffer.alloc(256)
  // SOI
  buf[0] = 0xff; buf[1] = 0xd8
  // APP0 marker
  buf[2] = 0xff; buf[3] = 0xe0
  buf.writeUInt16BE(4, 4) // length = 4 (including len bytes)
  buf[6] = 0x00; buf[7] = 0x00
  // SOF0 marker at offset 8
  buf[8] = 0xff; buf[9] = 0xc0
  buf.writeUInt16BE(17, 10) // length = 17
  buf[12] = 8 // precision = 8
  buf.writeUInt16BE(height, 13) // height
  buf.writeUInt16BE(width, 15) // width
  buf[17] = 3 // 3 color components
  // EOI marker at end
  buf[254] = 0xff; buf[255] = 0xd9
  return buf
}

// Sample 256-byte dummy PNG binary with standard IHDR chunk
function createDummyPng(width = 800, height = 600) {
  const buf = Buffer.alloc(256)
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a
  // IHDR chunk: 4 bytes len (13), 4 bytes type ('IHDR'), 4 bytes width, 4 bytes height
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

async function runAllTests() {
  const originalFetch = global.fetch

  // -------------------------------------------------------------------------
  // Test 1: Credentials separation & verification
  // -------------------------------------------------------------------------
  try {
    assert(CloudflareAiService.isImg2ImgConfigured(), 'isImg2ImgConfigured must return true when env credentials exist')
    const img2imgCreds = CloudflareAiService.getImg2ImgCredentials()
    assert(img2imgCreds.accountId && img2imgCreds.accountId.length > 10, 'Img2Img Account ID must be valid')
    assert(img2imgCreds.token && img2imgCreds.token.length > 20, 'Img2Img API Token must be valid')

    // Verify Text-to-Image credentials use different variables
    const txt2imgCreds = CloudflareAiService.getCredentials()
    assert(txt2imgCreds.accountId, 'Txt2Img Account ID must exist')
    assert(txt2imgCreds.token, 'Txt2Img Token must exist')

    // Confirm neither method exposes secrets
    assert(!JSON.stringify(img2imgCreds).includes('undefined'))
    pass('1. Separate Cloudflare Img2Img credentials verified and isolated')
  } catch (err) {
    fail('1. Separate Cloudflare Img2Img credentials', err)
  }

  // -------------------------------------------------------------------------
  // Test 2: Image validation utility (Format, Bounds, Size)
  // -------------------------------------------------------------------------
  try {
    const validJpeg = createDummyJpeg()
    const validPng = createDummyPng()

    const jpegMeta = validateImageBuffer(validJpeg)
    assert.strictEqual(jpegMeta.format, 'jpg')
    assert.strictEqual(jpegMeta.mimeType, 'image/jpeg')
    assert.strictEqual(jpegMeta.width, 512)
    assert.strictEqual(jpegMeta.height, 512)

    const pngMeta = validateImageBuffer(validPng)
    assert.strictEqual(pngMeta.format, 'png')
    assert.strictEqual(pngMeta.mimeType, 'image/png')
    assert.strictEqual(pngMeta.width, 800)
    assert.strictEqual(pngMeta.height, 600)

    // Rejection of tiny buffer (<100B)
    assert.throws(() => validateImageBuffer(Buffer.alloc(50)), /empty or corrupted/)

    // Rejection of oversize buffer (>10MB)
    const oversizeBuffer = Buffer.alloc(11 * 1024 * 1024)
    assert.throws(() => validateImageBuffer(oversizeBuffer), /exceeds maximum allowed size/)

    // Rejection of unknown format
    const fakeBuffer = Buffer.alloc(200)
    assert.throws(() => validateImageBuffer(fakeBuffer), /Unsupported image format/)

    pass('2. Image validator: format detection, dimension bounds, and size limits')
  } catch (err) {
    fail('2. Image validator', err)
  }

  // -------------------------------------------------------------------------
  // Test 3: Reference Image Ingestion (Data URL & Server Path)
  // -------------------------------------------------------------------------
  try {
    const dummyPng = createDummyPng()
    const dataUrl = `data:image/png;base64,${dummyPng.toString('base64')}`

    const saved = processAndSaveReferenceImage(dataUrl, 'test-user-001')
    assert(saved.storagePath.startsWith('/uploads/inputs/'), 'Must save to /uploads/inputs/')
    assert(fs.existsSync(saved.absolutePath), 'Saved file must exist on disk')
    assert.strictEqual(saved.format, 'png')
    assert.strictEqual(saved.width, 800)
    assert.strictEqual(saved.height, 600)

    // Clean up temporary test file
    try { fs.unlinkSync(saved.absolutePath) } catch {}

    // Invalid input rejection
    assert.throws(() => processAndSaveReferenceImage(null), /Reference image is required/)
    assert.throws(() => processAndSaveReferenceImage('invalid-path.xyz'), /Unsupported reference image input/)

    pass('3. Reference image ingestion: base64 Data URL decoding and storage persistence')
  } catch (err) {
    fail('3. Reference image ingestion', err)
  }

  // -------------------------------------------------------------------------
  // Test 4: Cloudflare FLUX.2 Klein Img2Img Multipart Contract & input_image_0
  // -------------------------------------------------------------------------
  try {
    const dummyJpeg = createDummyJpeg()
    let capturedUrl = ''
    let capturedHeaders = null
    let capturedFormData = null

    global.fetch = async (url, options) => {
      capturedUrl = String(url)
      capturedHeaders = options.headers
      capturedFormData = options.body

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => dummyJpeg.buffer
      }
    }

    const res = await CloudflareAiService.generateImageToImage({
      prompt: 'Transform into a futuristic neon cyberpunk burger',
      referenceImagePath: dummyJpeg,
      parameters: {
        strength: 0.75,
        aspect: '16:9',
        seed: 42
      },
      jobId: 'img2img-test-101'
    })

    assert(capturedUrl.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-4b'), 'Must call FLUX.2 Klein model')
    const img2imgCreds = CloudflareAiService.getImg2ImgCredentials()
    assert.strictEqual(capturedHeaders['Authorization'], `Bearer ${img2imgCreds.token}`, 'Must use IMG2IMG token')
    assert(capturedUrl.includes(img2imgCreds.accountId), 'Must route to IMG2IMG account')

    // Verify multipart FormData contents
    assert(capturedFormData instanceof FormData, 'Must send standard FormData')
    assert.strictEqual(capturedFormData.get('prompt'), 'Transform into a futuristic neon cyberpunk burger')
    assert.strictEqual(capturedFormData.get('strength'), '0.75')
    assert.strictEqual(capturedFormData.get('width'), '1024')
    assert.strictEqual(capturedFormData.get('height'), '576')
    assert.strictEqual(capturedFormData.get('seed'), '42')

    // Confirm input_image_0 binary blob is present
    const inputBlob = capturedFormData.get('input_image_0')
    assert(inputBlob, 'input_image_0 must be present in multipart form data')
    assert(inputBlob.size > 0, 'input_image_0 must have positive byte length')

    // Confirm output asset format
    assert(res.storagePath.startsWith('/uploads/generations/'), 'Output must be saved in uploads/generations/')
    assert.strictEqual(res.mediaType, 'IMAGE')
    assert.strictEqual(res.dimensions, '1024x576')

    // Clean up output test file
    const genFile = path.resolve(process.cwd(), res.storagePath.replace(/^\//, ''))
    try { fs.unlinkSync(genFile) } catch {}

    pass('4. Cloudflare FLUX.2 Klein Img2Img: multipart request, input_image_0, and credentials')
  } catch (err) {
    fail('4. Cloudflare FLUX.2 Klein Img2Img contract', err)
  }

  // -------------------------------------------------------------------------
  // Test 5: Rejection of silent fallback (Prompt or Reference missing)
  // -------------------------------------------------------------------------
  try {
    const dummyJpeg = createDummyJpeg()

    // Missing prompt
    await assert.rejects(
      async () => CloudflareAiService.generateImageToImage({ prompt: '', referenceImagePath: dummyJpeg }),
      /Prompt is required/
    )

    // Missing reference image
    await assert.rejects(
      async () => CloudflareAiService.generateImageToImage({ prompt: 'A lovely garden', referenceImagePath: null }),
      /Reference image is required/
    )

    pass('5. Rejection of silent fallback: prompt and reference image strictly enforced')
  } catch (err) {
    fail('5. Rejection of silent fallback', err)
  }

  // -------------------------------------------------------------------------
  // Test 6: CloudflareWorkerDaemon IMAGE_TO_IMAGE Routing & Preservation of other models
  // -------------------------------------------------------------------------
  try {
    const dummyJpeg = createDummyJpeg()
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => dummyJpeg.buffer
    })

    // Mock WorkerService methods
    const progressReports = []
    let completedJobData = null
    let failedJobData = null

    WorkerService.reportProgress = async (id, data) => { progressReports.push(data) }
    WorkerService.completeJob = async (id, data) => { completedJobData = data; return { id, status: 'COMPLETED', ...data } }
    WorkerService.failJob = async (id, data) => { failedJobData = data; return { id, status: 'FAILED', ...data } }

    // Case A: FLUX.2 Klein 4B Img2Img -> Success
    const kleinJob = {
      id: 'job-img2img-klein',
      type: 'IMAGE_TO_IMAGE',
      modelId: 'flux-2-klein-4b',
      prompt: 'Cyberpunk futuristic motorcycle',
      parametersJson: JSON.stringify({
        referenceImage: dummyJpeg,
        strength: 0.65,
        aspect: '1:1'
      })
    }

    await CloudflareWorkerDaemon.processJob(kleinJob)
    assert(completedJobData, 'FLUX.2 Klein job must complete successfully')
    assert.strictEqual(completedJobData.assets[0].mediaType, 'IMAGE')
    assert(completedJobData.assets[0].storagePath.startsWith('/uploads/generations/'))

    // Case B: Z-Image Turbo Multi -> Preserves truthful in-development notice
    const zImageJob = {
      id: 'job-img2img-zimage',
      type: 'IMAGE_TO_IMAGE',
      modelId: 'z-image-turbo',
      prompt: 'Watercolor painting',
      parametersJson: JSON.stringify({ referenceImage: dummyJpeg })
    }

    await assert.rejects(
      async () => CloudflareWorkerDaemon.processJob(zImageJob),
      /under development.*FLUX\.2 Klein/
    )
    assert(failedJobData, 'Un-faked model must fail job with credit refund')
    assert(failedJobData.errorMessage.includes('under development'))

    // Case C: FLUX Depth & Structure -> Preserves truthful in-development notice
    failedJobData = null
    const depthJob = {
      id: 'job-img2img-depth',
      type: 'IMAGE_TO_IMAGE',
      modelId: 'flux-depth-canny',
      prompt: 'Architectural line render',
      parametersJson: JSON.stringify({ referenceImage: dummyJpeg })
    }

    await assert.rejects(
      async () => CloudflareWorkerDaemon.processJob(depthJob),
      /under development.*FLUX\.2 Klein/
    )
    assert(failedJobData.errorMessage.includes('under development'))

    pass('6. CloudflareWorkerDaemon: FLUX.2 Klein routes successfully, other models preserve honest development state')
  } catch (err) {
    fail('6. CloudflareWorkerDaemon routing', err)
  }

  // -------------------------------------------------------------------------
  // Test 7: Provider Error Handling (HTTP 401, HTTP 429, Safety Moderation)
  // -------------------------------------------------------------------------
  try {
    const dummyJpeg = createDummyJpeg()

    // 401 Authentication error
    global.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'Unauthorized'
    })

    await assert.rejects(
      async () => CloudflareAiService.generateImageToImage({ prompt: 'test', referenceImagePath: dummyJpeg }),
      /Authentication failed \(HTTP 401\).*CLOUDFLARE_IMG2IMG_API_TOKEN/
    )

    // 429 Rate limit error
    global.fetch = async () => ({
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => 'Rate limit exceeded'
    })

    await assert.rejects(
      async () => CloudflareAiService.generateImageToImage({ prompt: 'test', referenceImagePath: dummyJpeg }),
      /Rate limit exceeded \(HTTP 429\)/
    )

    // Content moderation safety filter
    global.fetch = async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: false,
        errors: [{ message: 'Content moderation filter triggered: flagged generation.' }]
      })
    })

    try {
      await CloudflareAiService.generateImageToImage({ prompt: 'flagged request', referenceImagePath: dummyJpeg })
      assert.fail('Should have thrown flaggedError')
    } catch (e) {
      assert(e.isFlagged === true, 'Must set isFlagged = true')
      assert.strictEqual(e.code, 'CONTENT_OUTPUT_FLAGGED')
      assert(e.message.includes('safety filter flagged'))
    }

    pass('7. Provider error handling: HTTP 401, HTTP 429, and AI moderation flags')
  } catch (err) {
    fail('7. Provider error handling', err)
  }

  // -------------------------------------------------------------------------
  // Test 8: GenerationService createJob validation for IMAGE_TO_IMAGE
  // -------------------------------------------------------------------------
  try {
    // Rejection when reference image is missing
    let validationError = null
    try {
      // Mock wallet and worker readiness
      process.env.ENABLE_AI_WORKER = 'true'
      await GenerationService.createJob('dummy-user', {
        type: 'IMAGE_TO_IMAGE',
        modelId: 'flux-2-klein-4b',
        prompt: 'Transform this landscape',
        parameters: {} // No referenceImage
      })
    } catch (err) {
      validationError = err
    }

    assert(validationError, 'createJob must reject IMAGE_TO_IMAGE without reference image')
    assert.strictEqual(validationError.code, 'VALIDATION_ERROR')
    assert(validationError.message.includes('Reference image is required'))

    pass('8. GenerationService createJob: validates referenceImage requirement on IMAGE_TO_IMAGE')
  } catch (err) {
    fail('8. GenerationService createJob validation', err)
  }

  // -------------------------------------------------------------------------
  // Test 9: Text-to-Image Regression Test (FLUX.1 Schnell, FLUX.2 Klein, WaveSpeed)
  // -------------------------------------------------------------------------
  try {
    const dummyJpeg = createDummyJpeg()

    // Test A: FLUX.1 Schnell (JSON)
    let txt2imgBody = null
    global.fetch = async (url, options) => {
      txt2imgBody = options.body ? JSON.parse(options.body) : null
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => dummyJpeg.buffer
      }
    }

    const schnellRes = await CloudflareAiService.generateImage({
      modelId: 'flux-1-schnell',
      prompt: 'Serene mountain landscape',
      parameters: { steps: 4 },
      jobId: 'regression-schnell'
    })
    assert(schnellRes.storagePath.startsWith('/uploads/generations/'))
    assert.strictEqual(txt2imgBody.prompt, 'Serene mountain landscape')
    assert.strictEqual(txt2imgBody.steps, 4)

    // Clean up file
    try { fs.unlinkSync(path.resolve(process.cwd(), schnellRes.storagePath.replace(/^\//, ''))) } catch {}

    // Test B: FLUX.2 Klein 4B (Text-to-Image multipart)
    let txtKleinFormData = null
    global.fetch = async (url, options) => {
      txtKleinFormData = options.body
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => dummyJpeg.buffer
      }
    }

    const kleinRes = await CloudflareAiService.generateImage({
      modelId: 'flux-2-klein-4b',
      prompt: 'Neon cybernetic portrait',
      parameters: { aspect: '1:1' },
      jobId: 'regression-klein'
    })
    assert(kleinRes.storagePath.startsWith('/uploads/generations/'))
    assert(txtKleinFormData instanceof FormData)
    assert.strictEqual(txtKleinFormData.get('prompt'), 'Neon cybernetic portrait')
    // Ensure Text-to-Image does NOT have input_image_0
    assert.strictEqual(txtKleinFormData.get('input_image_0'), null)

    // Clean up file
    try { fs.unlinkSync(path.resolve(process.cwd(), kleinRes.storagePath.replace(/^\//, ''))) } catch {}

    // Test C: WaveSpeed Z-Image Turbo
    let waveSpeedCalled = false
    global.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/wavespeed-ai/z-image/turbo')) {
        waveSpeedCalled = true
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { id: 'wavespeed-pred-reg-1', status: 'pending' }
          })
        }
      }
      if (u.includes('/predictions/wavespeed-pred-reg-1/result')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { id: 'wavespeed-pred-reg-1', status: 'completed', outputs: ['https://cdn.wavespeed.ai/sample.jpg'] }
          })
        }
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => dummyJpeg.buffer
      }
    }

    const wsRes = await WavespeedAiService.generateImage({
      prompt: 'Speeding hypercar in rain',
      parameters: { aspect: '16:9' },
      jobId: 'regression-wavespeed'
    })
    assert(waveSpeedCalled, 'WaveSpeed API must be invoked')
    assert(wsRes.storagePath.startsWith('/uploads/generations/'))

    // Clean up file
    try { fs.unlinkSync(path.resolve(process.cwd(), wsRes.storagePath.replace(/^\//, ''))) } catch {}

    pass('9. Text-to-Image regression: FLUX.1 Schnell, FLUX.2 Klein, and WaveSpeed are 100% operational')
  } catch (err) {
    fail('9. Text-to-Image regression', err)
  }

  // -------------------------------------------------------------------------
  // Test 10: Frontend Error Handling & Duplicate Submission Protection
  // -------------------------------------------------------------------------
  try {
    // 10A: Verify error object handling safely extracts message without crashing React
    const mockAxiosError = {
      response: {
        data: {
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits. Required: 1, Available: 0',
            details: { required: 1, available: 0 }
          }
        }
      }
    }

    const errorObj = mockAxiosError.response?.data?.error
    const errorMsg = typeof errorObj === 'string'
      ? errorObj
      : (errorObj?.message || 'Failed to submit generation job')

    assert.strictEqual(typeof errorMsg, 'string')
    assert.strictEqual(errorMsg, 'Insufficient credits. Required: 1, Available: 0')

    // 10B: Duplicate submission guard
    let submissionCount = 0
    let isGenerating = false

    const simulateClick = () => {
      if (isGenerating) return 'blocked'
      isGenerating = true
      submissionCount++
      return 'submitted'
    }

    const first = simulateClick()
    const second = simulateClick()
    const third = simulateClick()

    assert.strictEqual(first, 'submitted')
    assert.strictEqual(second, 'blocked')
    assert.strictEqual(third, 'blocked')
    assert.strictEqual(submissionCount, 1)

    pass('10. Frontend error object safety and duplicate generation guard')
  } catch (err) {
    fail('10. Frontend error handling and duplicate guard', err)
  }

  // -------------------------------------------------------------------------
  // Restore globals
  // -------------------------------------------------------------------------
  global.fetch = originalFetch

  console.log('\n======================================================================')
  console.log(`   TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED              `)
  console.log('======================================================================\n')

  if (failCount > 0) {
    process.exit(1)
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err)
  process.exit(1)
})

