import http from 'http'
import fs from 'fs'
import path from 'path'
import { app } from '../src/app.js'
import { prisma } from '../src/config/database.js'

let server
const PORT = 5006
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
  console.log('   KIAAN STUDIO — MASTER PROMPT 1 FINAL AUDIT VERIFICATION')
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

  // Start test server on port 5006
  await new Promise((resolve) => {
    server = http.createServer(app)
    server.listen(PORT, () => {
      console.log(`[Test Server] Listening on ${PORT}`)
      resolve()
    })
  })

  const testEmailA = `audit_user_a_${Date.now()}@example.com`
  const testEmailB = `audit_user_b_${Date.now()}@example.com`
  let tokenA = ''
  let userIdA = ''
  let tokenB = ''
  let userIdB = ''

  let assetIdA = ''
  let downloadAssetId = ''
  let testFilePath = ''

  try {
    // 1. User Registration
    const regA = await request('/auth/register', {
      method: 'POST',
      body: { fullName: 'Alice Architect', email: testEmailA, password: 'Password123!' }
    })
    tokenA = regA.data.data.accessToken
    userIdA = regA.data.data.user.id
    assert(regA.status === 201 && !!tokenA, 'User A registered')

    const regB = await request('/auth/register', {
      method: 'POST',
      body: { fullName: 'Bob Browser', email: testEmailB, password: 'Password123!' }
    })
    tokenB = regB.data.data.accessToken
    userIdB = regB.data.data.user.id
    assert(regB.status === 201 && !!tokenB, 'User B registered for isolation')

    // 2. Audit Item 4: Avatar handling, validation, base64 conversion & storage
    console.log('\n--- Audit Item 4: Avatar Handling & Storage ---')
    const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const updateAvatar = await request('/users/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { avatarUrl: samplePng }
    })
    assert(updateAvatar.status === 200, 'PATCH /users/profile with Base64 data URL succeeds with 200')
    assert(
      updateAvatar.data.data.avatarUrl && updateAvatar.data.data.avatarUrl.startsWith('/uploads/avatars/'),
      'Base64 decoded and saved to disk; compact path returned without DB column overflow'
    )

    // Verify avatar is accessible via static endpoint
    const staticCheck = await fetch(`http://localhost:${PORT}${updateAvatar.data.data.avatarUrl}`)
    assert(staticCheck.status === 200, 'Saved avatar file is directly servable via /uploads/avatars/')

    // 3. Audit Item 2: Preferences per-user isolation in system_settings
    console.log('\n--- Audit Item 2: User Preferences Isolation ---')
    await request('/users/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { emailProductUpdates: true, autoDownload: true }
    })

    const prefsA = await request('/users/preferences', { headers: { Authorization: `Bearer ${tokenA}` } })
    assert(prefsA.data.data.emailProductUpdates === true, 'User A preferences saved in system_settings')

    const prefsB = await request('/users/preferences', { headers: { Authorization: `Bearer ${tokenB}` } })
    assert(prefsB.data.data.emailProductUpdates === false, 'User B preferences remain completely isolated')

    // 4. Audit Item 3: API keys clearly development-only
    console.log('\n--- Audit Item 3: Development-Only API Keys ---')
    const apiKeyRes = await request('/users/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: 'Dev Local Pipeline' }
    })
    assert(apiKeyRes.status === 201, 'POST /users/api-keys generates API key')
    assert(apiKeyRes.data.data.apiKey.startsWith('kiaan_dev_'), 'Key has explicit dev prefix: kiaan_dev_')
    assert(apiKeyRes.data.data.isDevelopmentOnly === true, 'Payload explicitly identifies key as development-only')

    // 5. Audit Item 1: Secure file downloads & history logged ONLY after delivery
    console.log('\n--- Audit Item 1: Secure Downloads & History Logging ---')
    const uploadDir = path.resolve(process.cwd(), 'uploads/test_media')
    fs.mkdirSync(uploadDir, { recursive: true })
    testFilePath = path.join(uploadDir, `render_test_${Date.now()}.png`)
    fs.writeFileSync(testFilePath, Buffer.from('TEST_IMAGE_FILE_PAYLOAD_BYTE_STREAM'))

    const job = await prisma.generationJob.create({
      data: {
        userId: userIdA,
        type: 'TEXT_TO_IMAGE',
        status: 'COMPLETED',
        modelId: 'FLUX.2 Klein 4B',
        prompt: 'Neon cybernetic cityscape',
        parametersJson: { steps: 4, cfg: 3.5 },
        creditCost: 1
      }
    })

    const asset = await prisma.generatedAsset.create({
      data: {
        userId: userIdA,
        jobId: job.id,
        mediaType: 'IMAGE',
        storagePath: `/uploads/test_media/${path.basename(testFilePath)}`,
        dimensions: '1024x1024',
        fileSizeBytes: BigInt(36),
        isFavorite: false
      }
    })
    downloadAssetId = asset.id

    // Check before download: 0 history records
    const countBefore = await prisma.downloadRecord.count({ where: { assetId: downloadAssetId } })
    assert(countBefore === 0, 'Zero download records exist prior to delivery')

    // Unauthorized download by User B
    const unauthRes = await request(`/assets/${downloadAssetId}/download`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    })
    assert(unauthRes.status === 404, 'User B unauthorized download blocked with 404')

    const countAfterUnauth = await prisma.downloadRecord.count({ where: { assetId: downloadAssetId } })
    assert(countAfterUnauth === 0, 'No download record created for unauthorized attempt')

    // Authorized download by User A
    const authDownload = await fetch(`${BASE_URL}/assets/${downloadAssetId}/download`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    assert(authDownload.status === 200, 'User A authorized download succeeds with 200')
    const bodyText = await authDownload.text()
    assert(bodyText === 'TEST_IMAGE_FILE_PAYLOAD_BYTE_STREAM', 'Delivered file content verified')

    // Wait 300ms for async response stream finish event
    await new Promise((r) => setTimeout(r, 300))

    const countAfterSuccess = await prisma.downloadRecord.count({ where: { assetId: downloadAssetId } })
    assert(countAfterSuccess === 1, 'Download record created in MySQL ONLY AFTER successful file delivery')
  } catch (err) {
    console.error('Audit exception:', err)
    failed++
  } finally {
    // Teardown
    console.log('\n--- Teardown Test Data ---')
    try {
      if (testFilePath && fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath)
      if (downloadAssetId) {
        await prisma.downloadRecord.deleteMany({ where: { assetId: downloadAssetId } })
        await prisma.generatedAsset.deleteMany({ where: { id: downloadAssetId } })
      }
      if (userIdA) {
        await prisma.generationJob.deleteMany({ where: { userId: userIdA } })
        await prisma.apiKey.deleteMany({ where: { userId: userIdA } })
        await prisma.systemSetting.deleteMany({ where: { key: `user_prefs_${userIdA}` } })
        await prisma.creditWallet.deleteMany({ where: { userId: userIdA } })
        await prisma.user.deleteMany({ where: { id: userIdA } })
      }
      if (userIdB) {
        await prisma.creditWallet.deleteMany({ where: { userId: userIdB } })
        await prisma.user.deleteMany({ where: { id: userIdB } })
      }
      console.log('Teardown complete.')
    } catch (e) {
      console.error('Teardown error:', e)
    }

    server.close()
    await prisma.$disconnect()
  }

  console.log('\n===============================================================')
  console.log(`   FINAL AUDIT RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('===============================================================\n')

  if (failed > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runTests()
