import http from 'http'
import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'

let server
const PORT = 5007
const BASE_URL = `http://localhost:${PORT}/api/v1`

async function request(pathUrl, options = {}) {
  const url = `${BASE_URL}${pathUrl}`
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, headers: res.headers }
}

async function runTests() {
  console.log('\n===============================================================')
  console.log('   KIAAN STUDIO — MASTER PROMPT 2/3 INTEGRATION TEST SUITE')
  console.log('===============================================================\n')

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`)
      passed++
    } else {
      console.error(`  ✗ FAIL: ${message}`)
      failed++
    }
  }

  // Start dedicated test server
  await new Promise((resolve) => {
    server = http.createServer(app)
    server.listen(PORT, () => {
      console.log(`[Test Server] Listening on ${PORT}`)
      resolve()
    })
  })

  const testEmail = `mp2_customer_${Date.now()}@example.com`
  let token = ''
  let userId = ''
  let testJobId = ''

  try {
    // 1. User Registration & Initial Wallet
    console.log('\n--- 1. User Registration & Credit Wallet ---')
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: { fullName: 'Sarah Studio', email: testEmail, password: 'Password123!' }
    })
    assert(regRes.status === 201, 'User registered successfully')
    token = regRes.data.data.accessToken
    userId = regRes.data.data.user.id

    // Check initial balance (25 credits)
    const balRes = await request('/credits/balance', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(balRes.status === 200, 'GET /credits/balance returns 200')
    assert(balRes.data.data.balance === 25, 'Initial balance is exactly 25 welcome credits')
    assert(balRes.data.data.reservedBalance === 0, 'Initial reservedBalance is 0')

    // 2. Credits Pricing & Top-Up Orders
    console.log('\n--- 2. Credits Pricing & Top-Up Orders ---')
    const pricingRes = await request('/credits/pricing')
    assert(pricingRes.status === 200, 'GET /credits/pricing returns 200 without auth')
    assert(pricingRes.data.data.TOPUP_PACKS.length === 3, 'Top-up packs catalog returned')

    const topUpOrderRes = await request('/credits/topup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { packId: 'topup-500' }
    })
    assert(topUpOrderRes.status === 201, 'POST /credits/topup creates pending order')
    assert(topUpOrderRes.data.data.status === 'PENDING', 'Order is created in PENDING state (no fake auto-charge)')

    // 3. Subscriptions & Billing
    console.log('\n--- 3. Subscriptions Plans & Invoices ---')
    const plansRes = await request('/subscriptions/plans')
    assert(plansRes.status === 200, 'GET /subscriptions/plans returns 200')
    assert(plansRes.data.data.length >= 3, 'Plans seeded and retrieved (Free, Creator Pro, Studio Ultimate)')

    const currentSubRes = await request('/subscriptions/current', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(currentSubRes.status === 200, 'GET /subscriptions/current returns 200')
    assert(currentSubRes.data.data.status === 'FREE_TIER', 'Default current status is FREE_TIER')

    const subOrderRes = await request('/subscriptions/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { planSlug: 'creator-pro', billingCycle: 'monthly' }
    })
    assert(subOrderRes.status === 201, 'POST /subscriptions/orders creates pending invoice')
    assert(subOrderRes.data.data.amount === 29, 'Invoice amount matches plan monthly price')

    const invoicesRes = await request('/subscriptions/invoices', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(invoicesRes.status === 200, 'GET /subscriptions/invoices returns 200')
    assert(invoicesRes.data.data.length >= 2, 'Both pending topup and subscription invoices listed')

    // 4. Generation Job Creation & Atomic Credit Reservation
    console.log('\n--- 4. Generation Job Creation & Atomic Reservation ---')
    const createJobRes = await request('/generation/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'TEXT_TO_IMAGE',
        modelId: 'flux-2-klein-4b',
        prompt: 'Futuristic hypercar in neon cyberpunk Tokyo'
      }
    })
    assert(createJobRes.status === 201, 'POST /generation/jobs enqueues job')
    testJobId = createJobRes.data.data.id
    assert(createJobRes.data.data.status === 'QUEUED', 'Job state is strictly QUEUED')
    assert(createJobRes.data.data.creditCost === 1, 'Credit cost is 1 for FLUX.2 text-to-image')

    // Verify atomic credit reservation in wallet
    const balAfterJob = await request('/credits/balance', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(balAfterJob.data.data.balance === 24, 'Available balance decremented by 1 (25 -> 24)')
    assert(balAfterJob.data.data.reservedBalance === 1, 'Reserved balance incremented by 1 (0 -> 1)')

    // 5. Job Cancellation & Atomic Credit Refund
    console.log('\n--- 5. Job Cancellation & Automatic Credit Refund ---')
    const cancelRes = await request(`/generation/jobs/${testJobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(cancelRes.status === 200, 'POST /generation/jobs/:id/cancel cancels queued job')
    assert(cancelRes.data.data.refundedCredits === 1, 'Canceled job refunds reserved credits')

    // Verify wallet after cancellation
    const balAfterCancel = await request('/credits/balance', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(balAfterCancel.data.data.balance === 25, 'Balance restored to 25 after cancellation')
    assert(balAfterCancel.data.data.reservedBalance === 0, 'Reserved balance decremented back to 0')

    // Verify transaction history logs DEBIT and REFUND
    const txRes = await request('/credits/transactions', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(txRes.status === 200, 'GET /credits/transactions returns 200')
    assert(txRes.data.data.length >= 2, 'Transactions logged for reservation and refund')

    // 6. Insufficient Credits Rejection (Guard against negative balance)
    console.log('\n--- 6. Insufficient Credits Rejection Guard ---')
    // A video job costs 25 credits. Let's create one (takes 25 credits).
    const videoJobRes = await request('/generation/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'TEXT_TO_VIDEO',
        modelId: 'wan-2.1-video-720p',
        prompt: 'Cinematic timelapse of flower blooming'
      }
    })
    assert(videoJobRes.status === 201, 'Video job enqueued consuming 25 credits')
    const videoJobId = videoJobRes.data.data.id

    // Now balance is 0. Attempting another job should be rejected with 402 Insufficient Credits
    const rejectedJobRes = await request('/generation/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'TEXT_TO_IMAGE',
        modelId: 'flux-2-klein-4b',
        prompt: 'Another image prompt'
      }
    })
    assert(rejectedJobRes.status === 402, 'Submitting job with 0 credits rejected with 402 INSUFFICIENT_CREDITS')

    // 7. AI Worker Interface: Claim, Progress, Complete & Fail
    console.log('\n--- 7. AI Worker Interface Lifecycle ---')
    // Worker claims the video job
    const claimRes = await request('/generation/worker/claim', {
      method: 'POST',
      body: { workerNodeId: 'gpu-node-h100-alpha' }
    })
    assert(claimRes.status === 200, 'Worker claims next queued job')
    assert(claimRes.data.data.id === videoJobId, 'Claimed job matches video job ID')
    assert(claimRes.data.data.status === 'PROCESSING', 'Job transitioned to PROCESSING status')

    // Worker reports progress
    const progRes = await request(`/generation/worker/jobs/${videoJobId}/progress`, {
      method: 'POST',
      body: { workerNodeId: 'gpu-node-h100-alpha', progressPercent: 45, currentStep: 14, totalSteps: 30 }
    })
    assert(progRes.status === 200, 'Worker reports intermediate progress')
    assert(progRes.data.data.progressPercent === 45, 'Progress percent recorded')

    // Worker fails the job -> triggers automatic refund
    const failRes = await request(`/generation/worker/jobs/${videoJobId}/fail`, {
      method: 'POST',
      body: { workerNodeId: 'gpu-node-h100-alpha', errorMessage: 'CUDA Out Of Memory on high temporal step' }
    })
    assert(failRes.status === 200, 'Worker reports failure')
    assert(failRes.data.data.refundedCredits === 25, 'Full 25 credits automatically refunded on worker failure')

    // Verify wallet balance restored after failure
    const balAfterFail = await request('/credits/balance', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(balAfterFail.data.data.balance === 25, 'Balance restored to 25 following worker failure')
    assert(balAfterFail.data.data.reservedBalance === 0, 'Reserved balance zeroed out')

    // Now test worker completing a job successfully
    const successJobRes = await request('/generation/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'TEXT_TO_IMAGE',
        modelId: 'flux-2-klein-4b',
        prompt: 'Futuristic botanical greenhouse'
      }
    })
    const successJobId = successJobRes.data.data.id

    const claimSuccess = await request('/generation/worker/claim', {
      method: 'POST',
      body: { workerNodeId: 'gpu-node-h100-alpha' }
    })
    assert(claimSuccess.data.data.id === successJobId, 'Worker claims second job')

    const completeRes = await request(`/generation/worker/jobs/${successJobId}/complete`, {
      method: 'POST',
      body: {
        workerNodeId: 'gpu-node-h100-alpha',
        executionTimeMs: 1240,
        assets: [
          {
            storagePath: '/images/landing/gallery-architecture.jpg',
            dimensions: '1024x1024',
            fileSizeBytes: 125343
          }
        ]
      }
    })
    assert(completeRes.status === 200, 'Worker completes job')
    assert(completeRes.data.data.job.status === 'COMPLETED', 'Job status marked COMPLETED')
    assert(completeRes.data.data.assets.length === 1, 'GeneratedAsset created in database')

    // Verify wallet after completion (1 credit finalized)
    const balFinal = await request('/credits/balance', {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(balFinal.data.data.balance === 24, 'Balance remains 24')
    assert(balFinal.data.data.reservedBalance === 0, 'Reserved balance decremented on completion (no double charge)')
  } catch (err) {
    console.error('Test execution error:', err)
    failed++
  } finally {
    // Teardown
    console.log('\n--- Teardown Test Data ---')
    try {
      if (userId) {
        await prisma.invoice.deleteMany({ where: { userId } })
        await prisma.generatedAsset.deleteMany({ where: { userId } })
        await prisma.generationJob.deleteMany({ where: { userId } })
        const wallet = await prisma.creditWallet.findUnique({ where: { userId } })
        if (wallet) {
          await prisma.creditTransaction.deleteMany({ where: { walletId: wallet.id } })
          await prisma.creditWallet.delete({ where: { id: wallet.id } })
        }
        await prisma.user.delete({ where: { id: userId } })
      }
      console.log('Teardown complete.')
    } catch (e) {
      console.error('Teardown error:', e)
    }

    server.close()
    await prisma.$disconnect()
  }

  console.log('\n===============================================================')
  console.log(`   TEST RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('===============================================================\n')

  if (failed > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runTests()
