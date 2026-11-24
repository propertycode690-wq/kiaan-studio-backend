import http from 'http'
import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'

let server
const PORT = 5003
const BASE_URL = `http://localhost:${PORT}/api/v1`

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
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
  console.log('   KIAAN STUDIO — CUSTOMER MODULES INTEGRATION TEST SUITE')
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

  const testEmailA = `test_customer_a_${Date.now()}@example.com`
  const testEmailB = `test_customer_b_${Date.now()}@example.com`
  let tokenA = ''
  let userIdA = ''
  let tokenB = ''
  let userIdB = ''

  let projectIdA = ''
  let assetIdA = ''
  let downloadIdA = ''

  try {
    // 1. Register User A
    console.log('\n--- 1. User Registration & Auth ---')
    const regA = await request('/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Alice Artist',
        email: testEmailA,
        password: 'Password123!'
      }
    })
    assert(regA.status === 201 && regA.data.success, 'Register User A succeeds')
    tokenA = regA.data.data.accessToken
    userIdA = regA.data.data.user.id
    assert(!!tokenA, 'Access token returned for User A')

    // Register User B for cross-user isolation tests
    const regB = await request('/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Bob Creator',
        email: testEmailB,
        password: 'Password123!'
      }
    })
    tokenB = regB.data.data.accessToken
    userIdB = regB.data.data.user.id
    assert(regB.status === 201 && !!tokenB, 'Register User B succeeds for isolation testing')

    // 2. Profile & Settings
    console.log('\n--- 2. Profile, Password, Preferences & API Keys ---')
    const profRes = await request('/users/profile', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(profRes.status === 200, 'GET /users/profile returns 200')
    assert(profRes.data.data.email === testEmailA, 'Profile matches User A email')
    assert(typeof profRes.data.data.creditBalance === 'number', 'Credit balance is present')

    // Update profile
    const updateProf = await request('/users/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        fullName: 'Alice W. Artist',
        bio: 'Senior Visual Effects Designer'
      }
    })
    assert(updateProf.status === 200, 'PATCH /users/profile returns 200')
    assert(updateProf.data.data.fullName === 'Alice W. Artist', 'Profile fullName updated')
    assert(updateProf.data.data.bio === 'Senior Visual Effects Designer', 'Profile bio updated')

    // Update password with wrong current password
    const failPass = await request('/users/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        currPassword: 'WrongPassword!',
        newPassword: 'NewSecurePassword123!'
      }
    })
    assert(failPass.status === 400, 'PUT /users/password rejects incorrect current password (400)')

    // Update password successfully
    const successPass = await request('/users/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        currPassword: 'Password123!',
        newPassword: 'NewSecurePassword123!'
      }
    })
    assert(successPass.status === 200, 'PUT /users/password accepts correct password and updates hash')

    // Preferences GET and PUT
    const getPrefs = await request('/users/preferences', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(getPrefs.status === 200 && getPrefs.data.data.emailCompletedJobs === true, 'GET /users/preferences returns defaults')

    const updatePrefs = await request('/users/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        emailProductUpdates: true,
        autoDownload: true
      }
    })
    assert(updatePrefs.status === 200 && updatePrefs.data.data.emailProductUpdates === true, 'PUT /users/preferences updates preferences')

    // API Keys CRUD
    const createKey = await request('/users/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: 'Automated Pipeline Key' }
    })
    assert(createKey.status === 201, 'POST /users/api-keys creates new API key')
    assert(createKey.data.data.apiKey.startsWith('kiaan_live_'), 'API key format starts with kiaan_live_')
    const keyId = createKey.data.data.id

    const listKeys = await request('/users/api-keys', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(listKeys.status === 200 && listKeys.data.data.length === 1, 'GET /users/api-keys lists active keys')

    const delKey = await request(`/users/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(delKey.status === 200, 'DELETE /users/api-keys/:id revokes key')

    // 3. Projects Module
    console.log('\n--- 3. Projects Management (CRUD & Scoping) ---')
    const createProj = await request('/projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        name: 'Cyberpunk Campaign',
        client: 'Neo Tokyo Studios',
        color: 'violet',
        description: 'Atmospheric neon aesthetics for sci-fi short film'
      }
    })
    assert(createProj.status === 201, 'POST /projects creates new project')
    projectIdA = createProj.data.data.id
    assert(createProj.data.data.name === 'Cyberpunk Campaign', 'Project name persisted correctly')
    assert(createProj.data.data.color === 'violet', 'Project color persisted correctly')

    // List projects for User A
    const listProjA = await request('/projects', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(listProjA.status === 200 && listProjA.data.data.length >= 1, 'GET /projects returns projects for User A')

    // Cross-user test: User B listing should NOT see User A's project
    const listProjB = await request('/projects', {
      headers: { Authorization: `Bearer ${tokenB}` }
    })
    assert(listProjB.status === 200 && listProjB.data.data.length === 0, 'User B cannot see User A projects (Data Isolation)')

    // Cross-user test: User B attempting to get User A's project
    const unauthorizedProjGet = await request(`/projects/${projectIdA}`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    })
    assert(unauthorizedProjGet.status === 404, 'User B accessing User A project returns 404')

    // Update project
    const updateProj = await request(`/projects/${projectIdA}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        name: 'Cyberpunk Campaign 2026',
        client: 'Neo Tokyo Studios HQ'
      }
    })
    assert(updateProj.status === 200 && updateProj.data.data.name === 'Cyberpunk Campaign 2026', 'PATCH /projects/:id updates project')

    // 4. Assets & Generations
    console.log('\n--- 4. Assets & Generations Module ---')
    // Seed a Generation Job and Generated Asset directly in DB for User A
    const job = await prisma.generationJob.create({
      data: {
        userId: userIdA,
        type: 'TEXT_TO_IMAGE',
        status: 'COMPLETED',
        modelId: 'FLUX.2 Klein 4B',
        prompt: 'Futuristic floating neon city over twilight alpine lake',
        parametersJson: { steps: 4, cfg: 3.5, seed: '123456789', aspect: '16:9' },
        creditCost: 1,
        executionTimeMs: 1420
      }
    })

    const asset = await prisma.generatedAsset.create({
      data: {
        userId: userIdA,
        jobId: job.id,
        projectId: projectIdA,
        mediaType: 'IMAGE',
        storagePath: '/images/landing/gallery-architecture.jpg',
        thumbnailPath: '/images/landing/gallery-architecture.jpg',
        dimensions: '1344x768',
        fileSizeBytes: BigInt(125343),
        isFavorite: false
      }
    })
    assetIdA = asset.id

    // List assets for User A
    const listAssets = await request('/assets', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(listAssets.status === 200, 'GET /assets returns 200')
    assert(listAssets.data.data.length === 1, 'Assets list contains the seeded asset')
    assert(listAssets.data.data[0].type === 'image', 'Asset type mapped correctly to lowercase')
    assert(listAssets.data.data[0].sizeBytes === 125343, 'BigInt sizeBytes serialized correctly to Number')

    // Toggle favorite
    const favRes = await request(`/assets/${assetIdA}/favorite`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(favRes.status === 200 && favRes.data.data.isFavorite === true, 'PATCH /assets/:id/favorite toggles favorite to true')

    // User B attempting to toggle favorite on User A asset
    const crossFav = await request(`/assets/${assetIdA}/favorite`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenB}` }
    })
    assert(crossFav.status === 404, 'User B cannot toggle favorite on User A asset (Data Isolation)')

    // 5. Customer Downloads Module
    console.log('\n--- 5. Customer Downloads History & Logging ---')
    const recDown = await request('/customer/downloads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        assetId: assetIdA,
        format: 'JPG'
      }
    })
    assert(recDown.status === 201, 'POST /customer/downloads records download event')
    downloadIdA = recDown.data.data.id

    const listDown = await request('/customer/downloads', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(listDown.status === 200 && listDown.data.data.length === 1, 'GET /customer/downloads returns download history')
    assert(listDown.data.meta.totalBytes === 125343, 'totalBytes calculated accurately in metadata')

    // User B cannot access User A's download record
    const delCrossDown = await request(`/customer/downloads/${downloadIdA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    })
    assert(delCrossDown.status === 404, 'User B cannot delete User A download record (Data Isolation)')

    // 6. Customer Dashboard Overview Aggregator
    console.log('\n--- 6. Customer Dashboard Overview Endpoint ---')
    const overviewRes = await request('/customer/dashboard/overview', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(overviewRes.status === 200, 'GET /customer/dashboard/overview returns 200')
    assert(overviewRes.data.data.stats.totalProjects === 1, 'Overview shows 1 total project')
    assert(overviewRes.data.data.stats.totalGenerations === 1, 'Overview shows 1 total generation')
    assert(overviewRes.data.data.recentGenerations.length === 1, 'Recent generations populated')
    assert(overviewRes.data.data.recentProjects.length === 1, 'Recent projects populated')

    // 7. Clean up Asset & Project Deletion
    console.log('\n--- 7. Deletion & Cleanup Verification ---')
    const delAsset = await request(`/assets/${assetIdA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(delAsset.status === 200, 'DELETE /assets/:id soft-deletes asset')

    // Verify asset is no longer returned in list
    const listAfterDel = await request('/assets', {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(listAfterDel.data.data.length === 0, 'Soft-deleted asset excluded from active list')

    // Clear downloads
    const clearDown = await request('/customer/downloads', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(clearDown.status === 200, 'DELETE /customer/downloads clears download history')

    // Delete project
    const delProj = await request(`/projects/${projectIdA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(delProj.status === 200, 'DELETE /projects/:id deletes project')
  } catch (err) {
    console.error('Test execution exception:', err)
    failed++
  } finally {
    // Database test records teardown
    console.log('\n--- Cleaning up test records in DB ---')
    try {
      if (assetIdA) {
        await prisma.downloadRecord.deleteMany({ where: { assetId: assetIdA } })
        await prisma.generatedAsset.deleteMany({ where: { id: assetIdA } })
      }
      if (userIdA) {
        await prisma.generationJob.deleteMany({ where: { userId: userIdA } })
        await prisma.project.deleteMany({ where: { userId: userIdA } })
        await prisma.apiKey.deleteMany({ where: { userId: userIdA } })
        await prisma.systemSetting.deleteMany({ where: { key: `user_prefs_${userIdA}` } })
        await prisma.creditWallet.deleteMany({ where: { userId: userIdA } })
        await prisma.user.deleteMany({ where: { id: userIdA } })
      }
      if (userIdB) {
        await prisma.creditWallet.deleteMany({ where: { userId: userIdB } })
        await prisma.user.deleteMany({ where: { id: userIdB } })
      }
      console.log('Cleanup completed successfully.')
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr)
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
