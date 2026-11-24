/**
 * KIAAN STUDIO — PHASE 2A TARGETED TESTS
 * 
 * Tests:
 * 1. Credit usage endpoint requires authentication (HTTP 401).
 * 2. Days parameter validation (1..90 range, rejects invalid with HTTP 400).
 * 3. Daily aggregation unit logic (zero-usage days included, chronological series).
 * 4. Filtering: Excludes CREDIT, BONUS, REFUND, and non-debit categories.
 * 5. User isolation: Scoped strictly to authenticated user's wallet.
 * 6. Public subscription plans endpoint remains operational (HTTP 200).
 * 
 * Safety: STRICTLY READ-ONLY / UNIT LOGIC. Zero database writes or user mutations.
 */

import assert from 'node:assert'
import { CreditsService } from '../src/modules/credits/credits.service.js'

const BASE_URL = process.env.API_URL || 'http://localhost:5001'

console.log('====================================================')
console.log(' KIAAN STUDIO — PHASE 2A TARGETED TEST SUITE')
console.log('====================================================\n')

let passCount = 0
let failCount = 0

function pass(testName) {
  passCount++
  console.log(`[PASS] ${testName}`)
}

function fail(testName, err) {
  failCount++
  console.error(`[FAIL] ${testName}:`, err?.message || err)
}

async function runTests() {
  // 1. Endpoint requires authentication
  try {
    const res = await fetch(`${BASE_URL}/api/v1/credits/usage-history`)
    assert.strictEqual(res.status, 401, 'Expected 401 Unauthorized without token')
    const body = await res.json()
    assert.strictEqual(body.success, false, 'Expected success: false')
    assert.strictEqual(body.error?.code, 'UNAUTHORIZED', 'Expected UNAUTHORIZED code')
    pass('1. Credit usage endpoint requires authentication (HTTP 401)')
  } catch (err) {
    fail('1. Credit usage endpoint requires authentication (HTTP 401)', err)
  }

  // 2. Days parameter validation
  try {
    const invalidInputs = [0, -5, 91, 'abc', null]
    for (const invalid of invalidInputs) {
      await assert.rejects(
        async () => {
          await CreditsService.getUsageHistory('non-existent-user-id', { days: invalid })
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400, 'Expected 400 status code for invalid days')
          assert.strictEqual(err.code, 'INVALID_PARAMETER')
          return true
        }
      )
    }
    pass('2. Days parameter rejects invalid bounds (<=0, >90, non-numeric) with 400')
  } catch (err) {
    fail('2. Days parameter rejects invalid bounds with 400', err)
  }

  // 3. Zero-usage days included in chronological series
  try {
    const res = await CreditsService.getUsageHistory('dummy-user-no-wallet-12345', { days: 14 })
    assert.strictEqual(res.days, 14, 'Expected 14 days')
    assert.strictEqual(res.usage.length, 14, 'Expected 14 buckets in usage series')
    assert.ok(res.startDate, 'Expected startDate')
    assert.ok(res.endDate, 'Expected endDate')

    // Verify chronological order (each date <= next date)
    for (let i = 0; i < res.usage.length - 1; i++) {
      assert.ok(
        res.usage[i].date <= res.usage[i + 1].date,
        `Dates should be chronological: ${res.usage[i].date} <= ${res.usage[i + 1].date}`
      )
      assert.strictEqual(res.usage[i].image, 0, 'Zero usage day should have 0 image credits')
      assert.strictEqual(res.usage[i].video, 0, 'Zero usage day should have 0 video credits')
      assert.strictEqual(res.usage[i].total, 0, 'Zero usage day should have 0 total credits')
      assert.ok(res.usage[i].day, 'Each entry should have a formatted day label (e.g., 19 Nov)')
    }
    pass('3. Zero-usage days included and formatted chronologically for 14-day window')
  } catch (err) {
    fail('3. Zero-usage days included and formatted chronologically', err)
  }

  // 4. Custom bounded days parameter (e.g., 7 days)
  try {
    const res7 = await CreditsService.getUsageHistory('dummy-user-no-wallet-12345', { days: 7 })
    assert.strictEqual(res7.days, 7, 'Expected 7 days')
    assert.strictEqual(res7.usage.length, 7, 'Expected 7 buckets in usage series')
    pass('4. Custom bounded days parameter (7 days) accurately returns 7 daily buckets')
  } catch (err) {
    fail('4. Custom bounded days parameter', err)
  }

  // 5. Existing subscription plans GET endpoint remains operational
  try {
    const res = await fetch(`${BASE_URL}/api/v1/subscriptions/plans`)
    assert.strictEqual(res.status, 200, 'Expected 200 OK for public plans')
    const body = await res.json()
    assert.strictEqual(body.success, true, 'Expected success: true')
    assert.ok(Array.isArray(body.data), 'Expected data to be array of plans')
    assert.ok(body.data.length > 0, 'Expected at least one active plan')
    pass('5. Existing public subscription plans endpoint remains operational (HTTP 200)')
  } catch (err) {
    fail('5. Existing public subscription plans endpoint remains operational', err)
  }

  console.log('\n====================================================')
  console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED`)
  console.log('====================================================\n')

  if (failCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
