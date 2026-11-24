/**
 * KIAAN STUDIO — BROWSER CUSTOMER END-TO-END FLOW VERIFICATION
 *
 * Simulates the exact frontend React client lifecycle:
 * 1. Login at /login as authorized test customer (user@gmail.com)
 * 2. Balance check before generation
 * 3. Generation with FLUX.2 Klein 4B via Frontend API format
 * 4. Poll until COMPLETED, verify asset, verify Vite proxy HTTP 200, verify credit deduction
 * 5. Generation with FLUX.1 Schnell via Frontend API format
 * 6. Poll until COMPLETED, verify asset, verify Vite proxy HTTP 200, verify credit deduction
 * 7. Query customer gallery (/dashboard/generations)
 * 8. Refresh persistence verification
 */

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const API_BASE = 'http://localhost:5001/api/v1'
const FRONTEND_BASE = 'http://localhost:5173'

console.log('====================================================')
console.log(' KIAAN STUDIO — CUSTOMER BROWSER FLOW VERIFICATION')
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

async function runFlow() {
  // --- Step 1: Customer Login ---
  let authToken = null
  let currentUser = null
  try {
    const loginResp = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@gmail.com', password: 'password = 12345678'.includes('12345678') ? '12345678' : '12345678' })
    })
    const loginData = await loginResp.json()
    assert.strictEqual(loginResp.status, 200, 'Login must return HTTP 200')
    assert.strictEqual(loginData.success, true, 'Login response success must be true')

    authToken = loginData.data?.accessToken || loginData.data?.tokens?.accessToken
    currentUser = loginData.data?.user
    assert.ok(authToken, 'Access token must be present')
    assert.strictEqual(currentUser.email, 'user@gmail.com')

    pass(`1. Customer login successful: ${currentUser.email} (${currentUser.role})`)
  } catch (err) {
    fail('1. Customer login successful', err)
    process.exit(1)
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`
  }

  // --- Step 2: Check Initial Balance ---
  let initialBalance = 0
  try {
    const balResp = await fetch(`${API_BASE}/credits/balance`, { headers: authHeaders })
    const balData = await balResp.json()
    assert.strictEqual(balResp.status, 200)
    initialBalance = balData.data.balance
    console.log(`[INFO] Current Wallet Balance: ${initialBalance} Credits\n`)
    pass(`2. Initial balance retrieved: ${initialBalance} credits`)
  } catch (err) {
    fail('2. Initial balance retrieved', err)
  }

  // Helper for polling job
  async function pollJob(jobId, maxWaitMs = 60000) {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const resp = await fetch(`${API_BASE}/generation/jobs/${jobId}`, { headers: authHeaders })
      const data = await resp.json()
      const job = data.data
      if (job.status === 'COMPLETED') return job
      if (job.status === 'FAILED') throw new Error(`Job #${jobId} failed: ${job.errorMessage}`)
      await new Promise((r) => setTimeout(r, 1500))
    }
    throw new Error(`Timeout waiting for job #${jobId}`)
  }

  // --- Step 3: FLUX.2 Klein 4B Generation ---
  let kleinAsset = null
  let balAfterKlein = 0
  try {
    const balBeforeKlein = (await (await fetch(`${API_BASE}/credits/balance`, { headers: authHeaders })).json()).data.balance
    console.log(`[TEST] Submitting FLUX.2 Klein 4B generation job (Current Balance: ${balBeforeKlein})...`)

    const jobPayload = {
      type: 'TEXT_TO_IMAGE',
      modelId: 'flux-2-klein-4b',
      prompt: 'A minimalist white ceramic vase with single green olive branch on a wooden pedestal, soft morning daylight, architectural interior photography',
      parameters: {
        aspect: '1:1',
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 3.5,
        sampler: 'Euler',
        seed: '1029384'
      }
    }

    const createResp = await fetch(`${API_BASE}/generation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(jobPayload)
    })
    const createData = await createResp.json()
    assert.strictEqual(createResp.status, 201, `Job creation returned ${createResp.status}: ${JSON.stringify(createData)}`)
    const jobId = createData.data.id

    console.log(`[TEST] Job #${jobId} enqueued. Polling status...`)
    const completedJob = await pollJob(jobId, 90000)

    assert.strictEqual(completedJob.status, 'COMPLETED')
    assert.strictEqual(completedJob.modelId, 'flux-2-klein-4b')
    assert.ok(completedJob.assets && completedJob.assets.length > 0)
    kleinAsset = completedJob.assets[0]

    // Verify file on disk
    const diskPath = path.resolve(process.cwd(), kleinAsset.src.replace(/^\//, ''))
    assert.ok(fs.existsSync(diskPath), `File must exist at ${diskPath}`)
    const stat = fs.statSync(diskPath)
    assert.ok(stat.size > 10000, `Image size must be > 10KB (got ${stat.size} bytes)`)

    // Verify accessible through Vite Proxy
    const viteResp = await fetch(`${FRONTEND_BASE}${kleinAsset.src}`)
    assert.strictEqual(viteResp.status, 200, 'Image must be accessible through Vite proxy (port 5173)')
    assert.strictEqual(viteResp.headers.get('content-type'), 'image/jpeg')

    // Verify balance decremented by 1
    const balRespAfter = await fetch(`${API_BASE}/credits/balance`, { headers: authHeaders })
    balAfterKlein = (await balRespAfter.json()).data.balance
    assert.strictEqual(balAfterKlein, balBeforeKlein - 1, 'Balance must be decremented by exactly 1 credit')

    console.log(`[INFO] FLUX.2 Klein 4B completed successfully: ${kleinAsset.src} (${stat.size} bytes)`)
    pass('3. FLUX.2 Klein 4B generation, asset storage, Vite proxy HTTP 200, and credit deduction verified')
  } catch (err) {
    fail('3. FLUX.2 Klein 4B generation verified', err)
  }

  // --- Step 4: FLUX.1 Schnell Generation ---
  let schnellAsset = null
  try {
    const balBeforeSchnell = (await (await fetch(`${API_BASE}/credits/balance`, { headers: authHeaders })).json()).data.balance
    console.log(`\n[TEST] Submitting FLUX.1 Schnell generation job (Current Balance: ${balBeforeSchnell})...`)

    const jobPayload = {
      type: 'TEXT_TO_IMAGE',
      modelId: 'flux-1-schnell',
      prompt: 'A glowing bioluminescent butterfly resting on an ancient mossy stone, enchanted forest at dusk, macro photography',
      parameters: {
        aspect: '1:1',
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 2.5,
        sampler: 'Euler',
        seed: '8821943'
      }
    }

    const createResp = await fetch(`${API_BASE}/generation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(jobPayload)
    })
    const createData = await createResp.json()
    assert.strictEqual(createResp.status, 201, `Job creation returned ${createResp.status}: ${JSON.stringify(createData)}`)
    const jobId = createData.data.id

    console.log(`[TEST] Job #${jobId} enqueued. Polling status...`)
    const completedJob = await pollJob(jobId, 90000)

    assert.strictEqual(completedJob.status, 'COMPLETED')
    assert.strictEqual(completedJob.modelId, 'flux-1-schnell')
    assert.ok(completedJob.assets && completedJob.assets.length > 0)
    schnellAsset = completedJob.assets[0]

    // Verify file on disk
    const diskPath = path.resolve(process.cwd(), schnellAsset.src.replace(/^\//, ''))
    assert.ok(fs.existsSync(diskPath), `File must exist at ${diskPath}`)
    const stat = fs.statSync(diskPath)
    assert.ok(stat.size > 10000, `Image size must be > 10KB (got ${stat.size} bytes)`)

    // Verify accessible through Vite Proxy
    const viteResp = await fetch(`${FRONTEND_BASE}${schnellAsset.src}`)
    assert.strictEqual(viteResp.status, 200, 'Image must be accessible through Vite proxy (port 5173)')
    assert.strictEqual(viteResp.headers.get('content-type'), 'image/jpeg')

    // Verify balance decremented by 1 again
    const balRespAfter = await fetch(`${API_BASE}/credits/balance`, { headers: authHeaders })
    const balAfterSchnell = (await balRespAfter.json()).data.balance
    assert.strictEqual(balAfterSchnell, balBeforeSchnell - 1, 'Balance must be decremented by 1 credit')

    console.log(`[INFO] FLUX.1 Schnell completed successfully: ${schnellAsset.src} (${stat.size} bytes)`)
    pass('4. FLUX.1 Schnell generation, asset storage, Vite proxy HTTP 200, and credit deduction verified')
  } catch (err) {
    fail('4. FLUX.1 Schnell generation verified', err)
  }

  // --- Step 5: Customer Gallery Verification ---
  try {
    const galleryResp = await fetch(`${API_BASE}/assets?limit=20&sort=newest`, { headers: authHeaders })
    assert.strictEqual(galleryResp.status, 200)
    const galleryData = await galleryResp.json()
    const assets = galleryData.data || []

    const assetSrcs = assets.map((a) => a.src || a.storagePath)
    if (kleinAsset) {
      assert.ok(assetSrcs.includes(kleinAsset.src), 'Klein asset must be in gallery')
    }
    if (schnellAsset) {
      assert.ok(assetSrcs.includes(schnellAsset.src), 'Schnell asset must be in gallery')
    }

    pass(`5. Customer gallery retrieved with ${assets.length} items; newly synthesized images present`)
  } catch (err) {
    fail('5. Customer gallery retrieval verified', err)
  }

  // --- Step 6: Refresh Persistence Verification ---
  try {
    // Re-query gallery as if user pressed F5
    const refreshResp = await fetch(`${API_BASE}/assets?limit=20&sort=newest`, { headers: authHeaders })
    const refreshData = await refreshResp.json()
    const refreshedAssets = refreshData.data || []

    assert.ok(refreshedAssets.length >= 2, 'Assets must persist after refresh')
    const firstAsset = refreshedAssets[0]

    // Verify the image file on port 5173 still responds with 200 OK
    const imgCheck = await fetch(`${FRONTEND_BASE}${firstAsset.src}`)
    assert.strictEqual(imgCheck.status, 200, 'Image URL must return 200 OK on refresh')

    pass('6. Images and gallery metadata persist across page refresh without broken links')
  } catch (err) {
    fail('6. Images and gallery metadata persist across page refresh without broken links', err)
  }

  console.log('\n====================================================')
  console.log(` SUMMARY: ${passCount} PASSED, ${failCount} FAILED`)
  console.log('====================================================\n')

  process.exit(failCount > 0 ? 1 : 0)
}

runFlow().catch((err) => {
  console.error('[FATAL FLOW ERROR]', err)
  process.exit(1)
})
