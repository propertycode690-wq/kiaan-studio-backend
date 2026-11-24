import assert from 'assert'
import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/config/database.js'

async function runTest() {
  console.log('=================================================================')
  console.log('      VERIFYING DYNAMIC SIGNUP STARTER CREDITS (PHASE 3)         ')
  console.log('=================================================================')

  const port = env.PORT || 5001
  let server = null
  const tempEmails = [
    `temp_test_50_${Date.now()}@test.com`,
    `temp_test_100_${Date.now()}@test.com`,
    `temp_test_0_${Date.now()}@test.com`
  ]

  // Helper for requests
  const request = async (endpoint, options = {}) => {
    const url = `http://localhost:${port}/api/v1${endpoint}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    })
    const data = await res.json().catch(() => null)
    return { status: res.status, data }
  }

  // Backup original setting
  const originalSetting = await prisma.systemSetting.findUnique({
    where: { key: 'defaultFreeCredits' }
  })
  const originalValue = originalSetting ? originalSetting.value : null

  // Backup pre-existing user count and balances
  const initialUsers = await prisma.user.findMany({
    select: { id: true, email: true, wallet: { select: { balance: true } } }
  })
  console.log(`[Baseline] Found ${initialUsers.length} pre-existing users. Preserving all records.`)

  try {
    // Check if server is already running
    let alreadyRunning = false
    try {
      const probe = await fetch(`http://localhost:${port}/api/health`)
      if (probe.status === 200) {
        alreadyRunning = true
        console.log(`[Test Client] Detected running server on port ${port}`)
      }
    } catch {}

    if (!alreadyRunning) {
      await new Promise((resolve) => {
        server = app.listen(port, () => {
          console.log(`[Test Server] Started on port ${port}`)
          resolve()
        })
      })
    }

    // 1. Authenticate as Admin
    console.log('\n[Step 1] Authenticating as Admin...')
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: { email: 'admin@gmail.com', password: '12345678', requestedAdmin: true }
    })
    assert(loginRes.status === 200, `Admin login failed: ${JSON.stringify(loginRes.data)}`)
    const adminToken = loginRes.data?.data?.accessToken
    const adminHeaders = { Authorization: `Bearer ${adminToken}` }
    console.log('✓ Admin authenticated successfully.')

    // 2. Test: Admin sets 50 -> New signup receives 50
    console.log('\n[Step 2] Admin sets defaultFreeCredits = 50...')
    const set50Res = await request('/admin/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: { defaultFreeCredits: 50 }
    })
    assert(set50Res.status === 200, `Failed to update settings to 50: ${JSON.stringify(set50Res.data)}`)
    assert(set50Res.data.data.defaultFreeCredits === 50, 'Updated setting should be 50')

    console.log(`  Registering new customer with ${tempEmails[0]}...`)
    const reg50Res = await request('/auth/register', {
      method: 'POST',
      body: { email: tempEmails[0], password: 'Password123!', fullName: 'Test User 50' }
    })
    assert(reg50Res.status === 201, `Signup failed: ${JSON.stringify(reg50Res.data)}`)
    assert(reg50Res.data.data.user.creditBalance === 50, `Expected 50 credits in signup response, got ${reg50Res.data.data.user.creditBalance}`)

    const user50Db = await prisma.user.findUnique({
      where: { email: tempEmails[0] },
      include: { wallet: { include: { transactions: true } } }
    })
    assert(user50Db.wallet.balance === 50, `DB wallet balance should be 50, got ${user50Db.wallet.balance}`)
    assert(user50Db.wallet.transactions.length === 1, 'Should have exactly 1 ledger transaction')
    assert(user50Db.wallet.transactions[0].amount === 50, 'Ledger amount should be 50')
    assert(user50Db.wallet.transactions[0].type === 'CREDIT', 'Transaction type should be CREDIT')
    assert(user50Db.wallet.transactions[0].category === 'ADMIN_GRANT', 'Transaction category should be ADMIN_GRANT')
    console.log('✓ Admin sets 50 -> Signup receives exactly 50 credits & ledger logged: PASS')

    // 3. Test: Admin sets 100 -> New signup receives 100
    console.log('\n[Step 3] Admin sets defaultFreeCredits = 100...')
    const set100Res = await request('/admin/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: { defaultFreeCredits: 100 }
    })
    assert(set100Res.status === 200, `Failed to update settings to 100: ${JSON.stringify(set100Res.data)}`)

    console.log(`  Registering new customer with ${tempEmails[1]}...`)
    const reg100Res = await request('/auth/register', {
      method: 'POST',
      body: { email: tempEmails[1], password: 'Password123!', fullName: 'Test User 100' }
    })
    assert(reg100Res.status === 201, `Signup failed: ${JSON.stringify(reg100Res.data)}`)
    assert(reg100Res.data.data.user.creditBalance === 100, `Expected 100 credits in signup response, got ${reg100Res.data.data.user.creditBalance}`)

    const user100Db = await prisma.user.findUnique({
      where: { email: tempEmails[1] },
      include: { wallet: { include: { transactions: true } } }
    })
    assert(user100Db.wallet.balance === 100, `DB wallet balance should be 100, got ${user100Db.wallet.balance}`)
    assert(user100Db.wallet.transactions[0].amount === 100, 'Ledger amount should be 100')
    console.log('✓ Admin sets 100 -> Signup receives exactly 100 credits & ledger logged: PASS')

    // 4. Test: Admin sets 0 -> New signup receives 0
    console.log('\n[Step 4] Admin sets defaultFreeCredits = 0...')
    const set0Res = await request('/admin/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: { defaultFreeCredits: 0 }
    })
    assert(set0Res.status === 200, `Failed to update settings to 0: ${JSON.stringify(set0Res.data)}`)

    console.log(`  Registering new customer with ${tempEmails[2]}...`)
    const reg0Res = await request('/auth/register', {
      method: 'POST',
      body: { email: tempEmails[2], password: 'Password123!', fullName: 'Test User 0' }
    })
    assert(reg0Res.status === 201, `Signup failed: ${JSON.stringify(reg0Res.data)}`)
    assert(reg0Res.data.data.user.creditBalance === 0, `Expected 0 credits in signup response, got ${reg0Res.data.data.user.creditBalance}`)

    const user0Db = await prisma.user.findUnique({
      where: { email: tempEmails[2] },
      include: { wallet: { include: { transactions: true } } }
    })
    assert(user0Db.wallet.balance === 0, `DB wallet balance should be 0, got ${user0Db.wallet.balance}`)
    assert(user0Db.wallet.transactions[0].amount === 0, 'Ledger amount should be 0')
    console.log('✓ Admin sets 0 -> Signup receives exactly 0 credits (0 not overridden): PASS')

    // 5. Test: Invalid settings rejection
    console.log('\n[Step 5] Testing invalid settings rejection...')
    const negRes = await request('/admin/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: { defaultFreeCredits: -20 }
    })
    assert(negRes.status === 400, `Negative credits should be rejected with 400, got ${negRes.status}`)
    const strRes = await request('/admin/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: { defaultFreeCredits: 'not_a_number' }
    })
    assert(strRes.status === 400, `Non-numeric credits should be rejected with 400, got ${strRes.status}`)
    console.log('✓ Invalid settings rejected safely with 400: PASS')

    // 6. Test: Repeated signup & login idempotency
    console.log('\n[Step 6] Testing idempotency (no repeat credit awards)...')
    const duplicateRes = await request('/auth/register', {
      method: 'POST',
      body: { email: tempEmails[0], password: 'Password123!', fullName: 'Duplicate User' }
    })
    assert(duplicateRes.status === 409, 'Duplicate signup should be rejected with 409')

    const userToken = reg50Res.data.data.accessToken
    const userHeaders = { Authorization: `Bearer ${userToken}` }
    const balRes = await request('/credits/balance', { headers: userHeaders })
    assert(balRes.status === 200, 'Balance check should succeed')
    assert(balRes.data.data.balance === 50, 'Balance should remain 50')

    const loginUserRes = await request('/auth/login', {
      method: 'POST',
      body: { email: tempEmails[0], password: 'Password123!' }
    })
    assert(loginUserRes.status === 200, 'Login should succeed')
    assert(loginUserRes.data.data.user.creditBalance === 50, 'Balance after login should still be 50')
    console.log('✓ Duplicate registration rejected & Login does not re-award credits: PASS')

    // 7. Test: Existing users' balances remain unchanged
    console.log('\n[Step 7] Verifying pre-existing users are 100% unaffected...')
    for (const initUser of initialUsers) {
      const current = await prisma.user.findUnique({
        where: { id: initUser.id },
        select: { wallet: { select: { balance: true } } }
      })
      const origBal = initUser.wallet?.balance ?? null
      const currBal = current.wallet?.balance ?? null
      assert(origBal === currBal, `Balance mismatch for existing user ${initUser.email}: was ${origBal}, now ${currBal}`)
    }
    console.log(`✓ All ${initialUsers.length} existing users' balances verified identical: PASS`)

    console.log('\n=================================================================')
    console.log('  ALL DYNAMIC SIGNUP STARTER CREDITS TESTS PASSED (100%)         ')
    console.log('=================================================================')
  } catch (err) {
    console.error('\n✗ TEST FAILED:', err)
    process.exitCode = 1
  } finally {
    // Clean up temporary test users only
    console.log('\n[Cleanup] Removing temporary test accounts...')
    for (const email of tempEmails) {
      const u = await prisma.user.findUnique({ where: { email } })
      if (u) {
        await prisma.creditTransaction.deleteMany({ where: { wallet: { userId: u.id } } })
        await prisma.creditWallet.deleteMany({ where: { userId: u.id } })
        await prisma.refreshToken.deleteMany({ where: { userId: u.id } })
        await prisma.user.delete({ where: { id: u.id } })
      }
    }
    console.log('✓ Temporary test accounts deleted.')

    // Restore original system setting
    if (originalValue !== null) {
      await prisma.systemSetting.upsert({
        where: { key: 'defaultFreeCredits' },
        update: { value: originalValue },
        create: { key: 'defaultFreeCredits', value: originalValue }
      })
      console.log(`✓ System setting defaultFreeCredits restored to original value: ${originalValue}`)
    }

    if (server) {
      server.close()
    }
    await prisma.$disconnect()
  }
}

runTest()
