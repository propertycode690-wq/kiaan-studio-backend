import http from 'http'
import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'

let server
const PORT = 5008
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
  console.log('   KIAAN STUDIO — MASTER PROMPT 3/3 INTEGRATION TEST SUITE')
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

  try {
    // -------------------------------------------------------------------------
    // 0. Setup Test Users: 1 Creator, 1 Admin
    // -------------------------------------------------------------------------
    const ts = Date.now()
    const creatorEmail = `creator.p3.${ts}@kiaanstudio.local`
    const adminEmail = `admin.p3.${ts}@kiaanstudio.local`

    // Register creator
    const regCreator = await request('/auth/register', {
      method: 'POST',
      body: { email: creatorEmail, password: 'Password123!', fullName: 'Creator P3' }
    })
    assert(regCreator.status === 201, 'Creator registered successfully')
    const creatorToken = regCreator.data.data.accessToken
    const creatorId = regCreator.data.data.user.id

    // Register second user and elevate to ADMIN in DB
    const regAdmin = await request('/auth/register', {
      method: 'POST',
      body: { email: adminEmail, password: 'AdminPassword123!', fullName: 'Admin P3' }
    })
    assert(regAdmin.status === 201, 'Admin user registered successfully')
    const adminId = regAdmin.data.data.user.id

    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'ADMIN' }
    })

    // Login as admin to get fresh token with ADMIN role
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: 'AdminPassword123!' }
    })
    assert(adminLogin.status === 200, 'Admin logged in')
    const adminToken = adminLogin.data.data.accessToken

    const creatorAuth = { Authorization: `Bearer ${creatorToken}` }
    const adminAuth = { Authorization: `Bearer ${adminToken}` }

    // -------------------------------------------------------------------------
    // 1. RBAC & Security Boundaries
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 1: RBAC & Access Control ---')

    const unauthRes = await request('/admin/overview')
    assert(unauthRes.status === 401, 'Unauthenticated request to /admin/overview returns 401')

    const creatorRes = await request('/admin/overview', { headers: creatorAuth })
    assert(creatorRes.status === 403, 'Creator role is forbidden from /admin/overview with 403')

    const adminRes = await request('/admin/overview', { headers: adminAuth })
    assert(adminRes.status === 200, 'Admin role can access /admin/overview with 200')
    assert(adminRes.data.data?.kpis !== undefined, 'KPIs object is returned in overview')
    assert(typeof adminRes.data.data.kpis.totalUsers === 'number', 'KPIs include totalUsers count')
    assert(typeof adminRes.data.data.kpis.platformRevenue === 'number', 'KPIs include platformRevenue')

    // -------------------------------------------------------------------------
    // 2. User Administration & Credit Adjustments
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: User Administration & Credit Mutations ---')

    const usersList = await request('/admin/users?limit=10', { headers: adminAuth })
    assert(usersList.status === 200, 'Admin can list users with pagination')
    assert(usersList.data.data?.users?.length >= 2, 'Listed users include creator and admin')

    // Check user search
    const searchRes = await request(`/admin/users?search=${encodeURIComponent(creatorEmail)}`, {
      headers: adminAuth
    })
    assert(searchRes.status === 200, 'Admin can search users by email')
    assert(searchRes.data.data.users[0]?.email === creatorEmail, 'Search found creator user')

    // Get user details
    const userDetail = await request(`/admin/users/${creatorId}`, { headers: adminAuth })
    assert(userDetail.status === 200, 'Admin can view comprehensive user details')
    assert(userDetail.data.data.wallet !== undefined, 'User details include wallet')

    // Credit adjustment: Grant +250 bonus credits
    const adjustRes = await request(`/admin/users/${creatorId}/credits`, {
      method: 'POST',
      headers: adminAuth,
      body: { amount: 250, reason: 'Special promotion bonus credits' }
    })
    assert(adjustRes.status === 200, 'Admin can grant credits to user')
    assert(adjustRes.data.data?.wallet?.balance >= 250, 'User wallet balance incremented')
    assert(adjustRes.data.data?.transaction?.category === 'ADMIN_GRANT', 'Transaction recorded as ADMIN_GRANT')

    // User status update: Suspend user
    const suspendRes = await request(`/admin/users/${creatorId}/status`, {
      method: 'PATCH',
      headers: adminAuth,
      body: { status: 'SUSPENDED', reason: 'Temporary security inspection' }
    })
    assert(suspendRes.status === 200, 'Admin can suspend user')
    assert(suspendRes.data.data.status === 'SUSPENDED', 'User status updated to SUSPENDED')

    // Reactivate user
    const reactivateRes = await request(`/admin/users/${creatorId}/status`, {
      method: 'PATCH',
      headers: adminAuth,
      body: { status: 'ACTIVE', reason: 'Inspection complete' }
    })
    assert(reactivateRes.status === 200, 'Admin can reactivate user to ACTIVE')

    // -------------------------------------------------------------------------
    // 3. GPU Node Fleet Management
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: GPU Hardware Fleet Management ---')

    const gpuNodesRes = await request('/admin/gpu/nodes', { headers: adminAuth })
    assert(gpuNodesRes.status === 200, 'Admin can list GPU nodes')
    assert(Array.isArray(gpuNodesRes.data.data), 'GPU nodes is an array')

    const testNodeId = `node-test-${ts}`
    const registerNode = await request('/admin/gpu/nodes', {
      method: 'POST',
      headers: adminAuth,
      body: {
        id: testNodeId,
        name: 'Automated Test Cluster Node',
        ipAddress: '192.168.1.50',
        gpuModel: 'NVIDIA H100 80GB SXM5',
        totalVramGb: 80,
        usedVramGb: 16,
        status: 'ONLINE'
      }
    })
    assert(registerNode.status === 200, 'Admin can register/heartbeat GPU node')
    assert(registerNode.data.data.id === testNodeId, 'Node registered with correct ID')

    // Worker heartbeat route verification
    const workerHeartbeat = await request('/generation/worker/heartbeat', {
      method: 'POST',
      body: {
        id: testNodeId,
        usedVramGb: 28,
        status: 'BUSY'
      }
    })
    assert(workerHeartbeat.status === 200, 'Worker can send autonomous heartbeat via generation route')

    // Update node status
    const updateNode = await request(`/admin/gpu/nodes/${testNodeId}`, {
      method: 'PATCH',
      headers: adminAuth,
      body: { status: 'DRAINING' }
    })
    assert(updateNode.status === 200, 'Admin can update GPU node status to DRAINING')

    // Delete test node
    const deleteNode = await request(`/admin/gpu/nodes/${testNodeId}`, {
      method: 'DELETE',
      headers: adminAuth
    })
    assert(deleteNode.status === 200, 'Admin can delete GPU node')

    // -------------------------------------------------------------------------
    // 4. AI Model Catalog
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 4: AI Model Catalog Management ---')

    const modelsRes = await request('/admin/models', { headers: adminAuth })
    assert(modelsRes.status === 200, 'Admin can list AI models')
    assert(modelsRes.data.data.length >= 3, 'Default AI models exist')

    const firstModel = modelsRes.data.data[0]
    const updateModel = await request(`/admin/models/${firstModel.id}`, {
      method: 'PATCH',
      headers: adminAuth,
      body: { baseCreditCost: firstModel.baseCreditCost + 1 }
    })
    assert(updateModel.status === 200, 'Admin can update model credit cost')
    assert(
      updateModel.data.data.baseCreditCost === firstModel.baseCreditCost + 1,
      'Model credit cost reflected in response'
    )

    // Revert model credit cost
    await request(`/admin/models/${firstModel.id}`, {
      method: 'PATCH',
      headers: adminAuth,
      body: { baseCreditCost: firstModel.baseCreditCost }
    })

    // -------------------------------------------------------------------------
    // 5. Subscription Plans & Confirmed Revenue
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 5: Subscription Plans & Revenue ---')

    const plansRes = await request('/admin/plans', { headers: adminAuth })
    assert(plansRes.status === 200, 'Admin can list subscription plans')
    assert(Array.isArray(plansRes.data.data), 'Plans list returned as array')

    const revenueRes = await request('/admin/revenue', { headers: adminAuth })
    assert(revenueRes.status === 200, 'Admin can get revenue breakdown')
    assert(revenueRes.data.data.confirmedRevenue !== undefined, 'Confirmed revenue reported')
    assert(revenueRes.data.data.pendingRevenue !== undefined, 'Pending receivables reported')

    // -------------------------------------------------------------------------
    // 6. Support Desk System (Customer & Admin Interaction)
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 6: Support Desk (Customer & Admin) ---')

    // Customer opens a ticket
    const createTicket = await request('/support/tickets', {
      method: 'POST',
      headers: creatorAuth,
      body: {
        subject: 'Inquiry regarding batch API rate limits',
        category: 'API Integration',
        priority: 'NORMAL',
        message: 'Could you please clarify the maximum concurrency allowed on the Creator Pro plan?'
      }
    })
    assert(createTicket.status === 201, 'Customer can open a support ticket')
    const ticketId = createTicket.data.data.id
    assert(ticketId !== undefined, 'Ticket ID generated')

    // Customer lists own tickets
    const myTickets = await request('/support/tickets', { headers: creatorAuth })
    assert(myTickets.status === 200, 'Customer can view own tickets')
    assert(myTickets.data.data.some((t) => t.id === ticketId), 'Created ticket is in customer list')

    // Admin lists all tickets
    const adminTickets = await request('/admin/support/tickets', { headers: adminAuth })
    assert(adminTickets.status === 200, 'Admin can list all customer tickets')
    assert(adminTickets.data.data.tickets.some((t) => t.id === ticketId), 'Ticket is visible to admin')

    // Admin replies to ticket
    const adminReply = await request(`/admin/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      headers: adminAuth,
      body: {
        message: 'Hello! Creator Pro supports up to 2 concurrent generation tasks across the cluster.',
        status: 'RESOLVED'
      }
    })
    assert(adminReply.status === 201, 'Admin can reply to customer ticket')

    // Customer views updated thread
    const customerView = await request(`/support/tickets/${ticketId}`, { headers: creatorAuth })
    assert(customerView.status === 200, 'Customer can view ticket details and messages')
    assert(customerView.data.data.messages.length === 2, 'Both customer inquiry and admin reply are present')
    assert(customerView.data.data.status === 'RESOLVED', 'Ticket status updated to RESOLVED')

    // -------------------------------------------------------------------------
    // 7. Security Audit Logging
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 7: Security Audit Logs ---')

    const auditLogs = await request('/admin/audit-logs?limit=20', { headers: adminAuth })
    assert(auditLogs.status === 200, 'Admin can query audit logs')
    assert(auditLogs.data.data.logs.length > 0, 'Audit logs have recorded events')

    const hasCreditAudit = auditLogs.data.data.logs.some((l) => l.action === 'CREDIT_ADJUSTMENT')
    assert(hasCreditAudit, 'Credit adjustment action recorded in AuditLog table')

    const hasStatusAudit = auditLogs.data.data.logs.some((l) => l.action === 'USER_STATUS_UPDATE')
    assert(hasStatusAudit, 'User status change recorded in AuditLog table')

    // -------------------------------------------------------------------------
    // 8. Global System Settings
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 8: System Settings ---')

    const settingsGet = await request('/admin/settings', { headers: adminAuth })
    assert(settingsGet.status === 200, 'Admin can get global system settings')

    const settingsPut = await request('/admin/settings', {
      method: 'PUT',
      headers: adminAuth,
      body: { systemNotice: 'Scheduled maintenance Sunday 02:00 UTC' }
    })
    assert(settingsPut.status === 200, 'Admin can update system settings')
    assert(
      settingsPut.data.data.systemNotice === 'Scheduled maintenance Sunday 02:00 UTC',
      'System notice saved successfully'
    )

    // Clean up test users
    await prisma.ticketMessage.deleteMany({ where: { ticketId } })
    await prisma.supportTicket.deleteMany({ where: { id: ticketId } })
    await prisma.creditTransaction.deleteMany({ where: { wallet: { userId: creatorId } } })
    await prisma.creditWallet.deleteMany({ where: { userId: creatorId } })
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    await prisma.auditLog.deleteMany({ where: { targetId: creatorId } })
    await prisma.user.deleteMany({ where: { id: { in: [creatorId, adminId] } } })

    console.log(`\n===============================================================`)
    console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED`)
    console.log(`===============================================================\n`)

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error('Fatal test execution error:', err)
    process.exit(1)
  } finally {
    if (server) {
      server.close()
    }
    await prisma.$disconnect()
  }
}

runTests()
