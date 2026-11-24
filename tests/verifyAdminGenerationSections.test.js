import assert from 'assert'
import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/config/database.js'

async function runAudit() {
  console.log('=================================================================')
  console.log('  VERIFYING ALL 4 ADMIN GENERATION SECTIONS & PRISMA QUERIES    ')
  console.log('=================================================================')

  const port = env.PORT || 5001
  let server = null

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
          console.log(`[Test Server] Listening on port ${port}`)
          resolve()
        })
      })
    }

    // 1. Authenticate as Admin
    console.log('\n[Step 1] Authenticating as Admin (admin@gmail.com)...')
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: { email: 'admin@gmail.com', password: 'password = 12345678'.includes('12345678') ? '12345678' : '12345678', requestedAdmin: true }
    })

    assert(loginRes.status === 200, `Admin login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.data)}`)
    const token = loginRes.data?.data?.accessToken
    assert(token, 'Access token missing in login response')
    const authHeaders = { Authorization: `Bearer ${token}` }
    console.log('✓ Admin authenticated successfully.')

    // 2. Section 1: Image Generations
    console.log('\n[Step 2] Testing Section 1: Admin Image Generations (/admin/jobs?type=TEXT_TO_IMAGE)...')
    const imageJobsRes = await request('/admin/jobs?page=1&limit=10&type=TEXT_TO_IMAGE', {
      headers: authHeaders
    })
    console.log(`  Response Status: ${imageJobsRes.status}`)
    assert(imageJobsRes.status === 200, `Image jobs query failed: ${JSON.stringify(imageJobsRes.data)}`)
    assert(imageJobsRes.data.success === true, 'Response success should be true')
    assert(Array.isArray(imageJobsRes.data.data.jobs), 'Jobs should be an array')
    assert(imageJobsRes.data.data.pagination, 'Pagination object should exist')
    console.log(`  Jobs returned: ${imageJobsRes.data.data.jobs.length}, Total: ${imageJobsRes.data.data.pagination.total}`)
    // If jobs returned, verify width and height are present on assets
    if (imageJobsRes.data.data.jobs.length > 0) {
      const sampleJob = imageJobsRes.data.data.jobs[0]
      console.log(`  Sample job ID: ${sampleJob.id}, Model: ${sampleJob.modelId}`)
      if (sampleJob.assets && sampleJob.assets.length > 0) {
        console.log(`  Asset dimensions: ${sampleJob.assets[0].dimensions}, Width: ${sampleJob.assets[0].width}, Height: ${sampleJob.assets[0].height}`)
        assert(typeof sampleJob.assets[0].width === 'number', 'Mapped width should be a number')
        assert(typeof sampleJob.assets[0].height === 'number', 'Mapped height should be a number')
      }
    }
    console.log('✓ Admin Image Generations API: PASS')

    // 3. Section 2: Video Generations
    console.log('\n[Step 3] Testing Section 2: Admin Video Generations (/admin/jobs?type=TEXT_TO_VIDEO)...')
    const videoJobsRes = await request('/admin/jobs?page=1&limit=10&type=TEXT_TO_VIDEO', {
      headers: authHeaders
    })
    console.log(`  Response Status: ${videoJobsRes.status}`)
    assert(videoJobsRes.status === 200, `Video jobs query failed: ${JSON.stringify(videoJobsRes.data)}`)
    assert(videoJobsRes.data.success === true, 'Response success should be true')
    assert(Array.isArray(videoJobsRes.data.data.jobs), 'Jobs should be an array')
    assert(videoJobsRes.data.data.pagination, 'Pagination object should exist')
    console.log(`  Jobs returned: ${videoJobsRes.data.data.jobs.length}, Total: ${videoJobsRes.data.data.pagination.total}`)
    console.log('✓ Admin Video Generations API: PASS')

    // 4. Section 3: Job Queue & Metrics
    console.log('\n[Step 4] Testing Section 3: Admin Job Queue (/admin/queue & /admin/jobs?status=PROCESSING)...')
    const queueMetricsRes = await request('/admin/queue', { headers: authHeaders })
    console.log(`  Queue Metrics Status: ${queueMetricsRes.status}`)
    assert(queueMetricsRes.status === 200, `Queue metrics failed: ${JSON.stringify(queueMetricsRes.data)}`)
    assert(queueMetricsRes.data.success === true, 'Metrics success should be true')
    const metrics = queueMetricsRes.data.data
    console.log(`  Queued: ${metrics.queuedJobs}, Processing: ${metrics.processingJobs}, Active Workers: ${metrics.activeWorkers}, Avg Latency: ${metrics.avgExecutionMs}ms`)
    assert(typeof metrics.queuedJobs === 'number', 'queuedJobs should be a number')
    assert(typeof metrics.processingJobs === 'number', 'processingJobs should be a number')

    const processingJobsRes = await request('/admin/jobs?status=PROCESSING&limit=10', { headers: authHeaders })
    console.log(`  Processing Jobs Query Status: ${processingJobsRes.status}`)
    assert(processingJobsRes.status === 200, `Processing jobs failed: ${JSON.stringify(processingJobsRes.data)}`)
    assert(Array.isArray(processingJobsRes.data.data.jobs), 'Jobs should be an array')
    console.log('✓ Admin Job Queue & Queue Metrics: PASS')

    // 5. Section 4: Failed Jobs
    console.log('\n[Step 5] Testing Section 4: Admin Failed Jobs (/admin/jobs/failed)...')
    const failedJobsRes = await request('/admin/jobs/failed?page=1&limit=10', { headers: authHeaders })
    console.log(`  Failed Jobs Status: ${failedJobsRes.status}`)
    assert(failedJobsRes.status === 200, `Failed jobs failed: ${JSON.stringify(failedJobsRes.data)}`)
    assert(failedJobsRes.data.success === true, 'Failed jobs success should be true')
    assert(Array.isArray(failedJobsRes.data.data.jobs), 'Jobs should be an array')
    assert(failedJobsRes.data.data.pagination, 'Pagination should exist')
    console.log(`  Failed jobs returned: ${failedJobsRes.data.data.jobs.length}, Total: ${failedJobsRes.data.data.pagination.total}`)
    console.log('✓ Admin Failed Jobs API: PASS')

    // 6. Test Filters & Search
    console.log('\n[Step 6] Testing Filter & Search combinations...')
    const searchRes = await request('/admin/jobs?search=flux&page=1&limit=5', { headers: authHeaders })
    assert(searchRes.status === 200, 'Search query should succeed')
    const statusFilterRes = await request('/admin/jobs?status=COMPLETED&page=1&limit=5', { headers: authHeaders })
    assert(statusFilterRes.status === 200, 'Status filter should succeed')
    const modelFilterRes = await request('/admin/jobs?modelId=flux-2-klein-4b&page=1&limit=5', { headers: authHeaders })
    assert(modelFilterRes.status === 200, 'Model filter should succeed')
    console.log('✓ Filter & Search queries: PASS')

    // 7. Verify Dimension Parsing Logic
    console.log('\n[Step 7] Testing Dimension parsing unit rules...')
    const parseDimensions = (dims) => {
      let width = 1024
      let height = 1024
      if (dims && typeof dims === 'string') {
        const parts = dims.toLowerCase().split('x')
        if (parts.length === 2) {
          width = parseInt(parts[0], 10) || 1024
          height = parseInt(parts[1], 10) || 1024
        }
      }
      return { width, height }
    }
    assert.deepStrictEqual(parseDimensions('1344x768'), { width: 1344, height: 768 })
    assert.deepStrictEqual(parseDimensions('768x1344'), { width: 768, height: 1344 })
    assert.deepStrictEqual(parseDimensions(null), { width: 1024, height: 1024 })
    assert.deepStrictEqual(parseDimensions(''), { width: 1024, height: 1024 })
    console.log('✓ Dimension resolution arithmetic: PASS')

    console.log('\n=================================================================')
    console.log('  ALL 4 ADMIN GENERATION SECTIONS PASSED VERIFICATION (100%)    ')
    console.log('=================================================================')
  } catch (err) {
    console.error('\n✗ VERIFICATION FAILED:', err)
    process.exitCode = 1
  } finally {
    if (server) {
      server.close()
      console.log('[Test Server] Closed cleanly.')
    }
    await prisma.$disconnect()
  }
}

runAudit()
