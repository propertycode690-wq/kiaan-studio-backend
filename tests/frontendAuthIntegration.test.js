import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'

async function runIntegrationTest() {
  console.log('=================================================================')
  console.log(' KIAAN STUDIO — PHASE 5E FRONTEND-BACKEND INTEGRATION TEST SUITE')
  console.log('=================================================================\n')

  const port = 5004
  let server
  let passCount = 0
  let failCount = 0

  const assert = (condition, title, details = '') => {
    if (condition) {
      console.log(`[PASS] ${title}`)
      passCount++
    } else {
      console.error(`[FAIL] ${title} ${details ? '- ' + details : ''}`)
      failCount++
    }
  }

  const testId = Date.now()
  const customerEmail = `e2e_customer_${testId}@studio.com`
  const adminEmail = `e2e_admin_${testId}@studio.com`
  const password = 'RealSecurePassword2026!'
  const cleanupUserIds = []

  try {
    server = app.listen(port)
    const baseUrl = `http://localhost:${port}/api/v1`

    // Helper with cookie jar emulation
    let cookieJar = {}

    const request = async (path, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }

      // Send cookies from jar
      if (Object.keys(cookieJar).length > 0) {
        headers['Cookie'] = Object.entries(cookieJar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      }

      const res = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers
      })

      // Capture Set-Cookie headers
      const setCookies = res.headers.getSetCookie?.() || []
      setCookies.forEach((cookieStr) => {
        const [pair] = cookieStr.split(';')
        const [k, v] = pair.split('=')
        if (k && v) {
          cookieJar[k.trim()] = v.trim()
        }
      })

      const data = await res.json().catch(() => null)
      return { status: res.status, data, headers: res.headers }
    }

    // -------------------------------------------------------------
    // Test 1: Real Customer Registration via POST /auth/register
    // -------------------------------------------------------------
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Alex River',
        email: customerEmail,
        password: password
      })
    })

    assert(regRes.status === 201 && regRes.data.success, '1. Customer registration succeeds with 201')
    assert(regRes.data.data.user.role === 'CREATOR', '1a. Role is assigned as CREATOR')
    assert(Boolean(cookieJar['kiaan_refresh_token']), '1b. HttpOnly refresh token cookie set in response')

    const customerUserId = regRes.data.data.user.id
    cleanupUserIds.push(customerUserId)
    const customerAccessToken = regRes.data.data.accessToken

    // -------------------------------------------------------------
    // Test 2: Authenticated /auth/me Profile Hydration
    // -------------------------------------------------------------
    const meRes = await request('/auth/me', {
      headers: { Authorization: `Bearer ${customerAccessToken}` }
    })
    assert(meRes.status === 200 && meRes.data.success, '2. GET /auth/me succeeds with Bearer token')
    assert(meRes.data.data.user.email === customerEmail, '2a. User profile matches registered email')
    assert(meRes.data.data.user.creditBalance === 25, '2b. Wallet balance is 25 initial welcome credits')

    // -------------------------------------------------------------
    // Test 3: Customer Blocked from Admin Dashboard
    // -------------------------------------------------------------
    const adminBlockedRes = await request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${customerAccessToken}` }
    })
    assert(
      adminBlockedRes.status === 403 && adminBlockedRes.data.error.code === 'FORBIDDEN',
      '3. Customer account is forbidden (403) from accessing admin routes'
    )

    // -------------------------------------------------------------
    // Test 4: Admin Account Provisioning & Real Admin Login
    // -------------------------------------------------------------
    // Seed real admin in DB
    const adminHash = regRes.data.data.user.passwordHash || (await prisma.user.findUnique({ where: { id: customerUserId } })).passwordHash
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'E2E System Admin',
        passwordHash: adminHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE'
      }
    })
    cleanupUserIds.push(adminUser.id)

    const adminLoginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: adminEmail,
        password: password,
        requestedAdmin: true
      })
    })
    assert(adminLoginRes.status === 200 && adminLoginRes.data.success, '4. Real Admin login succeeds with 200')
    const adminAccessToken = adminLoginRes.data.data.accessToken

    const adminAccessRes = await request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminAccessToken}` }
    })
    assert(
      adminAccessRes.status === 200 && adminAccessRes.data.success,
      '4a. Administrator successfully accesses /admin/dashboard with 200 OK'
    )

    // -------------------------------------------------------------
    // Test 5: Session Persistence & Token Refresh via Cookie
    // -------------------------------------------------------------
    const refreshRes = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}) // Refresh token delivered via cookieJar
    })
    assert(refreshRes.status === 200 && refreshRes.data.success, '5. Session refresh using HttpOnly cookie succeeds')
    assert(Boolean(refreshRes.data.data.accessToken), '5a. New rotated access token received')

    // -------------------------------------------------------------
    // Test 6: Real Logout & Session Invalidation
    // -------------------------------------------------------------
    const logoutRes = await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({})
    })
    assert(logoutRes.status === 200 && logoutRes.data.success, '6. Real logout succeeds with 200')

    // Subsequent refresh attempt must fail with 401
    const postLogoutRefresh = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({})
    })
    assert(postLogoutRefresh.status === 401, '6a. Refreshing after logout is rejected with 401')

    console.log(`\n=================================================================`)
    console.log(` INTEGRATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`)
    console.log(`=================================================================\n`)
  } catch (err) {
    console.error('Integration Test Error:', err)
    failCount++
  } finally {
    console.log('[Cleanup] Removing isolated test records from MySQL...')
    if (cleanupUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: cleanupUserIds } }
      })
      console.log(`[Cleanup] Deleted ${cleanupUserIds.length} test accounts.`)
    }
    await prisma.$disconnect()
    if (server) {
      server.close()
    }
  }

  process.exit(failCount > 0 ? 1 : 0)
}

runIntegrationTest()
