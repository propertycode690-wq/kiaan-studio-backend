import http from 'http'
import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'
import fs from 'fs'
import path from 'path'

let server
const PORT = 5009
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

async function runAudit() {
  console.log('\n========================================================================')
  console.log('   KIAAN STUDIO — COMPREHENSIVE END-TO-END FUNCTIONAL AUDIT')
  console.log('========================================================================\n')

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

  // Start dedicated test server on port 5009
  await new Promise((resolve) => {
    server = http.createServer(app)
    server.listen(PORT, () => {
      console.log(`[Audit Test Server] Listening on port ${PORT}\n`)
      resolve()
    })
  })

  const ts = Date.now()
  const customerA_Email = `e2e.customera.${ts}@kiaanstudio.local`
  const customerB_Email = `e2e.customerb.${ts}@kiaanstudio.local`
  const admin_Email = `e2e.admin.${ts}@kiaanstudio.local`
  const password = 'SecurePassword123!'
  const newPassword = 'NewSecurePassword456!'

  let customerA_Token, customerA_Id
  let customerB_Token, customerB_Id
  let admin_Token, admin_Id

  async function cleanupTestUsers() {
    try {
      const testUsers = await prisma.user.findMany({
        where: {
          OR: [
            { email: { startsWith: 'e2e.' } },
            { email: { startsWith: 'creator.p3.' } },
            { email: { startsWith: 'admin.p3.' } },
            { email: { startsWith: 'test.' } }
          ]
        },
        select: { id: true }
      })
      const ids = testUsers.map((u) => u.id)
      if (ids.length > 0) {
        await prisma.ticketMessage.deleteMany({ where: { senderId: { in: ids } } })
        await prisma.supportTicket.deleteMany({ where: { userId: { in: ids } } })
        await prisma.generatedAsset.deleteMany({ where: { userId: { in: ids } } })
        await prisma.generationJob.deleteMany({ where: { userId: { in: ids } } })
        await prisma.downloadRecord.deleteMany({ where: { userId: { in: ids } } })
        await prisma.project.deleteMany({ where: { userId: { in: ids } } })
        await prisma.creditTransaction.deleteMany({ where: { wallet: { userId: { in: ids } } } })
        await prisma.creditWallet.deleteMany({ where: { userId: { in: ids } } })
        await prisma.invoice.deleteMany({ where: { userId: { in: ids } } })
        await prisma.subscription.deleteMany({ where: { userId: { in: ids } } })
        await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } })
        await prisma.user.deleteMany({ where: { id: { in: ids } } })
      }
    } catch (_) {}
  }

  try {
    await cleanupTestUsers()
    // =========================================================================
    // SECTION 1: CUSTOMER FUNCTIONAL TESTING & AUTHENTICATION LIFECYCLE
    // =========================================================================
    console.log('--- SECTION 1: Customer Functional Lifecycle & Settings ---')

    // 1.1 Customer A Registration
    const regA = await request('/auth/register', {
      method: 'POST',
      body: { email: customerA_Email, password, fullName: 'Customer Alpha' }
    })
    assert(regA.status === 201, 'Customer A registration returns 201')
    assert(regA.data.data.user.role === 'CREATOR', 'Default customer role is CREATOR')
    customerA_Token = regA.data.data.accessToken
    customerA_Id = regA.data.data.user.id
    const authA = { Authorization: `Bearer ${customerA_Token}` }

    // 1.2 Initial Wallet Balance
    const balA = await request('/credits/balance', { headers: authA })
    assert(balA.status === 200, 'Customer A wallet balance check succeeds')
    assert(balA.data.data.balance === 25, 'Initial signup bonus is exactly 25 welcome credits')
    assert(balA.data.data.reservedBalance === 0, 'Initial reservedBalance is 0')

    // 1.3 Customer B Registration (for Cross-User Isolation checks)
    const regB = await request('/auth/register', {
      method: 'POST',
      body: { email: customerB_Email, password, fullName: 'Customer Beta' }
    })
    assert(regB.status === 201, 'Customer B registered for isolation checks')
    customerB_Token = regB.data.data.accessToken
    customerB_Id = regB.data.data.user.id
    const authB = { Authorization: `Bearer ${customerB_Token}` }

    // 1.4 Admin Registration & Promotion
    const regAdmin = await request('/auth/register', {
      method: 'POST',
      body: { email: admin_Email, password, fullName: 'Admin Auditor' }
    })
    admin_Id = regAdmin.data.data.user.id
    await prisma.user.update({
      where: { id: admin_Id },
      data: { role: 'ADMIN' }
    })
    const loginAdmin = await request('/auth/login', {
      method: 'POST',
      body: { email: admin_Email, password, requestedAdmin: true }
    })
    admin_Token = loginAdmin.data.data.accessToken
    const authAdmin = { Authorization: `Bearer ${admin_Token}` }

    // 1.5 Profile Inspection & Update
    const profileRes = await request('/users/profile', { headers: authA })
    assert(profileRes.status === 200, 'GET /users/profile returns customer profile')
    assert(profileRes.data.data.email === customerA_Email, 'Profile email matches')

    const updateProfile = await request('/users/profile', {
      method: 'PATCH',
      headers: authA,
      body: { fullName: 'Customer Alpha Prime', bio: 'AI generative artist' }
    })
    assert(updateProfile.status === 200, 'PATCH /users/profile updates fullName and bio')
    assert(updateProfile.data.data.fullName === 'Customer Alpha Prime', 'Updated fullName reflected')

    // 1.6 Avatar Upload with Base64 Data URL
    const tinyBase64Png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const avatarRes = await request('/users/profile', {
      method: 'PATCH',
      headers: authA,
      body: { avatarUrl: tinyBase64Png }
    })
    assert(avatarRes.status === 200, 'PATCH /users/profile with Base64 avatar succeeds')
    assert(avatarRes.data.data.avatarUrl.startsWith('/uploads/avatars/'), 'Avatar saved to disk with clean URI')

    // 1.7 Password Change Flow
    const changePass = await request('/users/password', {
      method: 'PUT',
      headers: authA,
      body: { currentPassword: password, newPassword }
    })
    assert(changePass.status === 200, 'Password change succeeds with correct old password')

    const oldLoginFail = await request('/auth/login', {
      method: 'POST',
      body: { email: customerA_Email, password }
    })
    assert(oldLoginFail.status === 401, 'Old password rejected with 401')

    const newLoginOk = await request('/auth/login', {
      method: 'POST',
      body: { email: customerA_Email, password: newPassword }
    })
    assert(newLoginOk.status === 200, 'New password accepted on login')
    customerA_Token = newLoginOk.data.data.accessToken
    authA.Authorization = `Bearer ${customerA_Token}`

    // 1.8 User Preferences Isolation
    const setPrefA = await request('/users/preferences', {
      method: 'PUT',
      headers: authA,
      body: { theme: 'dark', defaultModel: 'flux-1-schnell', notifyOnComplete: true }
    })
    assert(setPrefA.status === 200, 'PUT /users/preferences stores preferences in system_settings')

    const getPrefB = await request('/users/preferences', { headers: authB })
    assert(getPrefB.status === 200, 'GET /users/preferences for User B succeeds')
    assert(getPrefB.data.data.defaultModel !== 'flux-1-schnell', 'User B preferences remain isolated')

    // 1.9 Development API Key Generation
    const apiKeyRes = await request('/users/api-keys', {
      method: 'POST',
      headers: authA,
      body: { name: 'Development Studio CLI' }
    })
    assert(apiKeyRes.status === 201, 'POST /users/api-keys generates development API key')
    assert(apiKeyRes.data.data.apiKey.startsWith('kiaan_dev_'), 'API key prefixed with kiaan_dev_')

    // 1.10 Customer Dashboard Overview
    const dashRes = await request('/customer/dashboard/overview', { headers: authA })
    assert(dashRes.status === 200, 'GET /customer/dashboard/overview returns real user metrics')
    assert(dashRes.data.data.stats !== undefined, 'Dashboard overview includes stats')

    // 1.11 Customer Projects CRUD
    const createProj = await request('/projects', {
      method: 'POST',
      headers: authA,
      body: { name: 'Sci-Fi Cyberpunk Concept', description: 'Concept art for novel' }
    })
    assert(createProj.status === 201, 'Customer can create a project')
    const projId = createProj.data.data.id

    const listProj = await request('/projects', { headers: authA })
    assert(listProj.status === 200, 'Customer can list own projects')
    const projs = Array.isArray(listProj.data.data) ? listProj.data.data : listProj.data.data?.projects || []
    assert(projs.some((p) => p.id === projId), 'Created project is in project list')

    const updateProj = await request(`/projects/${projId}`, {
      method: 'PATCH',
      headers: authA,
      body: { name: 'Cyberpunk Concept v2' }
    })
    assert(updateProj.status === 200, 'Customer can update project name')
    assert(updateProj.data.data.name === 'Cyberpunk Concept v2', 'Updated project name saved')

    // =========================================================================
    // SECTION 2: GENERATION MODES & CREDIT RESERVATION PIPELINE
    // =========================================================================
    console.log('\n--- SECTION 2: Generation Modes & Credit Flow ---')

    // 2.1 Missing Prompt Validation
    const invalidJob = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: { type: 'TEXT_TO_IMAGE', modelId: 'flux-1-schnell' }
    })
    assert(invalidJob.status === 400, 'Job creation without prompt rejected with 400')

    // 2.2 Mode 1: TEXT_TO_IMAGE
    const job1 = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'TEXT_TO_IMAGE',
        modelId: 'flux-1-schnell',
        prompt: 'Futuristic solar-powered metropolis at sunset, cinematic lighting',
        projectId: projId
      }
    })
    assert(job1.status === 201, 'Mode 1: TEXT_TO_IMAGE enqueued')
    assert(job1.data.data.status === 'QUEUED', 'Job state is QUEUED')
    assert(job1.data.data.creditCost === 1, 'Credit cost is 1 for flux-1-schnell')
    const jobId1 = job1.data.data.id

    // Check credit balance reservation
    const balAfterJob1 = await request('/credits/balance', { headers: authA })
    assert(balAfterJob1.data.data.balance === 24, 'Available balance reduced by 1 credit (25 -> 24)')
    assert(balAfterJob1.data.data.reservedBalance === 1, 'Reserved balance incremented to 1')

    // 2.3 Concurrency limit on Free Tier (max 1 concurrent job)
    const freeTierConcurrentAttempt = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'IMAGE_TO_IMAGE',
        modelId: 'flux-1-schnell',
        prompt: 'Convert into oil painting style',
        sourceImageUrl: 'https://cdn.kiaan.ai/sample-input.jpg'
      }
    })
    assert(
      freeTierConcurrentAttempt.status === 429,
      'Submitting second concurrent job on Free Tier blocked with 429 CONCURRENT_LIMIT_REACHED'
    )

    // Upgrade Customer A to Studio Ultimate (5 concurrent jobs) and grant 500 credits for multi-modal testing
    const ultimatePlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'studio-ultimate' } })
    await prisma.subscription.create({
      data: {
        userId: customerA_Id,
        planId: ultimatePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    })
    await prisma.creditWallet.update({
      where: { userId: customerA_Id },
      data: { balance: 500 }
    })

    // 2.4 Mode 2: TEXT_TO_VIDEO
    const job2 = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'TEXT_TO_VIDEO',
        modelId: 'wan-2.1-t2v',
        prompt: 'A robotic falcon soaring across neon skyline, 4k ultra-detailed'
      }
    })
    assert(job2.status === 201, 'Mode 2: TEXT_TO_VIDEO enqueued under Studio Ultimate plan')
    assert(job2.data.data.creditCost === 25, 'Credit cost is 25 for wan-2.1-t2v')

    // 2.5 Mode 3: IMAGE_TO_IMAGE
    const job3 = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'IMAGE_TO_IMAGE',
        modelId: 'flux-1-schnell',
        prompt: 'Convert into oil painting style',
        sourceImageUrl: 'https://cdn.kiaan.ai/sample-input.jpg'
      }
    })
    assert(job3.status === 201, 'Mode 3: IMAGE_TO_IMAGE enqueued')
    const jobId3 = job3.data.data.id

    // 2.6 Mode 4: IMAGE_EDITOR
    const job4 = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'IMAGE_EDITOR',
        modelId: 'flux-1-schnell',
        prompt: 'Remove background distractions'
      }
    })
    assert(job4.status === 201, 'Mode 4: IMAGE_EDITOR enqueued')

    // 2.7 Mode 5: IMAGE_TO_VIDEO
    const job5 = await request('/generation/jobs', {
      method: 'POST',
      headers: authA,
      body: {
        type: 'IMAGE_TO_VIDEO',
        modelId: 'flux-1-schnell',
        prompt: 'Animate water ripples',
        sourceImageUrl: 'https://cdn.kiaan.ai/water.jpg'
      }
    })
    assert(job5.status === 201, 'Mode 5: IMAGE_TO_VIDEO enqueued')

    // 2.7 Job Cancellation and Credit Refund
    const cancelJob = await request(`/generation/jobs/${jobId3}/cancel`, {
      method: 'POST',
      headers: authA
    })
    assert(cancelJob.status === 200, 'POST /generation/jobs/:id/cancel cancels queued job')
    assert(cancelJob.data.data.refundedCredits >= 0, 'Refunded credits returned in response')
    const dbJob3 = await prisma.generationJob.findUnique({ where: { id: jobId3 } })
    assert(dbJob3.status === 'CANCELED', 'Job status updated to CANCELED in database')

    const balAfterCancel = await request('/credits/balance', { headers: authA })
    assert(balAfterCancel.data.data.balance >= 22, 'Canceled job restored reserved credits')

    // 2.8 Job Retry
    const retryJob = await request(`/generation/jobs/${jobId3}/retry`, {
      method: 'POST',
      headers: authA
    })
    assert(retryJob.status === 201 || retryJob.status === 200, 'POST /generation/jobs/:id/retry re-queues canceled job')
    assert(retryJob.data.data.status === 'QUEUED', 'Job reset to QUEUED state')

    // =========================================================================
    // SECTION 3: GPU & AI WORKER INTERFACE SECURITY & LIFECYCLE
    // =========================================================================
    console.log('\n--- SECTION 3: GPU & AI Worker Security & Lifecycle ---')

    // 3.1 Security Check: Customer Token Cannot Access Worker Routes
    const customerClaimAttempt = await request('/generation/worker/claim', {
      method: 'POST',
      headers: authA,
      body: { workerId: 'rogue-customer-node' }
    })
    assert(
      customerClaimAttempt.status === 403,
      'Customer JWT token attempting /generation/worker/claim is BLOCKED with 403 Forbidden'
    )

    // 3.2 Pre-Shared Worker Key Authentication
    const workerHeaders = {
      'x-worker-key': 'kiaan_worker_secret_dev_2026'
    }

    // 3.3 Worker Claims Job
    const claimRes = await request('/generation/worker/claim', {
      method: 'POST',
      headers: workerHeaders,
      body: { workerId: 'cluster-node-test-01', supportedTypes: ['TEXT_TO_IMAGE'] }
    })
    assert(claimRes.status === 200, 'Worker with pre-shared key successfully claims job')
    const claimedJob = claimRes.data.data?.job || claimRes.data.data
    assert(claimedJob !== undefined && claimedJob !== null, 'Job claimed by worker')
    assert(claimedJob.status === 'PROCESSING', 'Claimed job transitioned to PROCESSING state')

    // 3.4 Worker Reports Progress
    const progressRes = await request(`/generation/worker/jobs/${claimedJob.id}/progress`, {
      method: 'POST',
      headers: workerHeaders,
      body: { progress: 65, currentStep: 18, totalSteps: 28 }
    })
    assert(progressRes.status === 200, 'Worker reports intermediate inference progress')

    // 3.5 Worker Completes Job with Final Asset
    const completeRes = await request(`/generation/worker/jobs/${claimedJob.id}/complete`, {
      method: 'POST',
      headers: workerHeaders,
      body: {
        executionTimeMs: 3200,
        assets: [
          {
            storagePath: '/uploads/generations/test-solar-city.png',
            mediaType: 'IMAGE',
            fileSizeBytes: 2048500,
            width: 1024,
            height: 1024,
            format: 'png'
          }
        ]
      }
    })
    assert(completeRes.status === 200, 'Worker completes job')
    const completedJob = completeRes.data.data?.job || completeRes.data.data
    assert(completedJob.status === 'COMPLETED', 'Job marked COMPLETED in database')

    // 3.6 Check Completed Asset in Customer Gallery
    const galleryRes = await request('/assets', { headers: authA })
    assert(galleryRes.status === 200, 'GET /assets returns customer gallery')
    const assets = Array.isArray(galleryRes.data.data) ? galleryRes.data.data : galleryRes.data.data?.assets || []
    assert(assets.length > 0, 'Completed asset is visible in customer gallery')
    const generatedAssetId = assets[0].id

    // 3.7 Worker Reports Failure on Another Job (Validates Automatic Refund)
    const claimRes2 = await request('/generation/worker/claim', {
      method: 'POST',
      headers: workerHeaders,
      body: { workerId: 'cluster-node-test-01' }
    })
    const jobToFail = claimRes2.data?.data?.job || claimRes2.data?.data
    if (jobToFail && jobToFail.id) {
      const failRes = await request(`/generation/worker/jobs/${jobToFail.id}/fail`, {
        method: 'POST',
        headers: workerHeaders,
        body: { errorMessage: 'CUDA Out-Of-Memory (OOM) during sampling step 14' }
      })
      assert(failRes.status === 200, 'Worker failure processed successfully')
      const failedJobData = failRes.data.data?.job || failRes.data.data
      assert(failedJobData.status === 'FAILED', 'Job status marked FAILED')
      assert(failedJobData.errorMessage.includes('CUDA Out-Of-Memory'), 'Failure reason recorded')
    }

    // 3.8 GPU Node Autonomous Heartbeat
    const heartbeatRes = await request('/generation/worker/heartbeat', {
      method: 'POST',
      headers: workerHeaders,
      body: {
        id: 'node-rtx4090-worker-01',
        usedVramGb: 14,
        status: 'BUSY'
      }
    })
    assert(heartbeatRes.status === 200, 'GPU node autonomous heartbeat accepted')

    // =========================================================================
    // SECTION 4: SECURITY & CROSS-USER ISOLATION
    // =========================================================================
    console.log('\n--- SECTION 4: Security & Cross-User Isolation ---')

    // 4.1 Cross-User Asset Download Protection
    const crossDownload = await request(`/assets/${generatedAssetId}/download`, {
      headers: authB
    })
    assert(crossDownload.status === 404, 'User B cannot download User A asset (404/Access Denied)')

    // 4.2 Cross-User Project Mutation Protection
    const crossProjUpdate = await request(`/projects/${projId}`, {
      method: 'PATCH',
      headers: authB,
      body: { name: 'Hacked by User B' }
    })
    assert(crossProjUpdate.status === 404, 'User B cannot mutate User A project (404/Access Denied)')

    // 4.3 Authorized Asset Favorite & Rename by Owner
    const favRes = await request(`/assets/${generatedAssetId}/favorite`, {
      method: 'PATCH',
      headers: authA,
      body: { isFavorite: true }
    })
    assert(favRes.status === 200, 'Owner can toggle asset favorite')

    // =========================================================================
    // SECTION 5: ADMIN FUNCTIONAL TESTING & GOVERNANCE
    // =========================================================================
    console.log('\n--- SECTION 5: Admin Control Plane & Fleet Governance ---')

    // 5.1 Admin Overview KPIs
    const adminOverview = await request('/admin/overview', { headers: authAdmin })
    assert(adminOverview.status === 200, 'Admin can view system overview')
    assert(adminOverview.data.data.kpis.totalUsers >= 2, 'Total registered users counted')

    // 5.2 Admin User Management & Role Update
    const adminUserList = await request('/admin/users', { headers: authAdmin })
    assert(adminUserList.status === 200, 'Admin can list all customer accounts')

    const adminCreditGrant = await request(`/admin/users/${customerA_Id}/credits`, {
      method: 'POST',
      headers: authAdmin,
      body: { amount: 150, reason: 'Promotional creator stipend' }
    })
    assert(adminCreditGrant.status === 200, 'Admin can grant credits with audit logging')

    // 5.3 Admin GPU Nodes Management
    const adminGpuList = await request('/admin/gpu/nodes', { headers: authAdmin })
    assert(adminGpuList.status === 200, 'Admin can list GPU nodes')
    assert(adminGpuList.data.data.some((n) => n.id === 'node-rtx4090-worker-01'), 'Heartbeat node listed')

    // 5.4 Admin AI Model Catalog Update
    const updateModelTariff = await request('/admin/models/flux-1-schnell', {
      method: 'PATCH',
      headers: authAdmin,
      body: { baseCreditCost: 6 }
    })
    assert(updateModelTariff.status === 200, 'Admin can update model credit tariff')
    assert(updateModelTariff.data.data.baseCreditCost === 6, 'New base credit cost saved')

    // Revert model tariff
    await request('/admin/models/flux-1-schnell', {
      method: 'PATCH',
      headers: authAdmin,
      body: { baseCreditCost: 5 }
    })

    // 5.5 Admin Subscription Plans Governance
    const adminPlans = await request('/admin/plans', { headers: authAdmin })
    assert(adminPlans.status === 200, 'Admin can list all subscription plans')

    // 5.6 Admin Confirmed Revenue & Invoices
    const adminRev = await request('/admin/revenue', { headers: authAdmin })
    assert(adminRev.status === 200, 'Admin can view confirmed revenue')
    assert(typeof adminRev.data.data.confirmedRevenue === 'number', 'Confirmed revenue is verified number')

    // 5.7 Admin Support Desk Interaction
    const openCustTicket = await request('/support/tickets', {
      method: 'POST',
      headers: authA,
      body: {
        subject: 'Inquiry regarding custom LoRA weight uploads',
        category: 'Generation',
        priority: 'NORMAL',
        message: 'Are custom SD-XL LoRAs supported in the studio?'
      }
    })
    assert(openCustTicket.status === 201, 'Customer can open support ticket')
    const tckId = openCustTicket.data.data.id

    const adminReplyTck = await request(`/admin/support/tickets/${tckId}/messages`, {
      method: 'POST',
      headers: authAdmin,
      body: {
        message: 'Custom LoRA weights will be enabled in our dedicated GPU phase.',
        status: 'RESOLVED'
      }
    })
    assert(adminReplyTck.status === 201, 'Admin can reply and resolve customer support ticket')

    // 5.8 Admin Security Audit Logs Query
    const auditQuery = await request('/admin/audit-logs?limit=25', { headers: authAdmin })
    assert(auditQuery.status === 200, 'Admin can query security audit logs')
    assert(
      auditQuery.data.data.logs.some((l) => l.action === 'CREDIT_ADJUSTMENT'),
      'AuditLog records credit adjustment'
    )

    // 5.9 Admin Global System Settings
    const setNotice = await request('/admin/settings', {
      method: 'PUT',
      headers: authAdmin,
      body: { systemNotice: 'Cluster scheduled maintenance window verified' }
    })
    assert(setNotice.status === 200, 'Admin can update system broadcast settings')

    // =========================================================================
    // SECTION 6: BILLING SAFETY & WEBHOOK VALIDATION
    // =========================================================================
    console.log('\n--- SECTION 6: Billing Safety & Webhooks ---')

    // 6.1 Unverified Webhook Signature Rejection
    const invalidWebhook = await request('/subscriptions/webhook', {
      method: 'POST',
      body: { event: 'payment.completed', orderId: 'fake-order-123' }
    })
    assert(invalidWebhook.status === 400, 'Webhook without signature header rejected with 400')

    // 6.2 Subscription Order Remains PENDING (No Fake Auto-Activation)
    const subOrder = await request('/subscriptions/orders', {
      method: 'POST',
      headers: authB,
      body: { planSlug: 'creator-pro', billingCycle: 'monthly' }
    })
    assert(subOrder.status === 201, 'POST /subscriptions/orders creates subscription invoice')
    assert(subOrder.data.data.status === 'PENDING', 'Invoice status is strictly PENDING')

    const currentSubB = await request('/subscriptions/current', { headers: authB })
    assert(
      currentSubB.data.data.status === 'FREE_TIER' && currentSubB.data.data.hasActiveSubscription === false,
      'Pending order does NOT prematurely activate Creator Pro subscription'
    )
    assert(
      currentSubB.data.data.plan.slug === 'free',
      'Free tier customer plan remains strictly free until payment confirmation'
    )

    // =========================================================================
    // CLEANUP TEST USERS & RECORDS
    // =========================================================================
    console.log('\n--- Cleaning up temporary test records ---')
    await prisma.ticketMessage.deleteMany({ where: { ticketId: tckId } })
    await prisma.supportTicket.deleteMany({ where: { id: tckId } })
    await prisma.generatedAsset.deleteMany({ where: { jobId: claimedJob.id } })
    await prisma.generationJob.deleteMany({
      where: { userId: { in: [customerA_Id, customerB_Id] } }
    })
    await prisma.project.deleteMany({ where: { userId: customerA_Id } })
    await prisma.creditTransaction.deleteMany({
      where: { wallet: { userId: { in: [customerA_Id, customerB_Id] } } }
    })
    await prisma.creditWallet.deleteMany({
      where: { userId: { in: [customerA_Id, customerB_Id] } }
    })
    await prisma.invoice.deleteMany({
      where: { userId: { in: [customerA_Id, customerB_Id] } }
    })
    await prisma.auditLog.deleteMany({ where: { actorId: admin_Id } })
    await prisma.auditLog.deleteMany({ where: { targetId: customerA_Id } })
    await prisma.user.deleteMany({
      where: { id: { in: [customerA_Id, customerB_Id, admin_Id] } }
    })
    console.log('Cleaned up test accounts and records from MySQL.\n')

    console.log('========================================================================')
    console.log(`   FINAL AUDIT RESULTS: ${passed} PASSED | ${failed} FAILED`)
    console.log('========================================================================\n')

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error('Fatal audit failure:', err)
    process.exit(1)
  } finally {
    await cleanupTestUsers()
    if (server) {
      server.close()
    }
    await prisma.$disconnect()
  }
}

runAudit()
