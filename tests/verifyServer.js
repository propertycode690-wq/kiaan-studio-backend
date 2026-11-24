import { app } from '../src/app.js'
import { env } from '../src/config/env.js'

async function runTest() {
  const port = env.PORT || 5001

  // Check if a server is already running on port
  let server = null
  let isAlreadyRunning = false

  try {
    const probe = await fetch('http://localhost:' + port + '/api/health')
    if (probe.status === 200) {
      console.log('Detected active server already running on port ' + port)
      isAlreadyRunning = true
    }
  } catch {
    isAlreadyRunning = false
  }

  const executeChecks = async () => {
    // Test 1: Health Check Endpoint
    const healthRes = await fetch('http://localhost:' + port + '/api/health')
    const healthData = await healthRes.json()
    console.log('HEALTH_CHECK_STATUS:', healthRes.status)
    console.log('HEALTH_CHECK_BODY:', JSON.stringify(healthData, null, 2))

    // Test 2: Modular Router Verification
    const modRes = await fetch('http://localhost:' + port + '/api/v1/admin/status')
    const modData = await modRes.json()
    console.log('MODULAR_ROUTER_STATUS:', modRes.status, JSON.stringify(modData))

    // Test 3: 404 Handler Verification
    const notFoundRes = await fetch('http://localhost:' + port + '/api/v1/non-existent-route')
    const notFoundData = await notFoundRes.json()
    console.log('NOT_FOUND_STATUS:', notFoundRes.status, JSON.stringify(notFoundData))

    console.log('ALL VERIFICATION CHECKS PASSED!')
  }

  if (isAlreadyRunning) {
    try {
      await executeChecks()
    } catch (err) {
      console.error('VERIFICATION FAILED:', err)
      process.exitCode = 1
    }
  } else {
    server = app.listen(port, async () => {
      try {
        console.log('Test server started on port ' + port)
        await executeChecks()
      } catch (err) {
        console.error('VERIFICATION FAILED:', err)
        process.exitCode = 1
      } finally {
        server.close(() => {
          console.log('Test server shut down cleanly.')
        })
      }
    })
  }
}

runTest()
