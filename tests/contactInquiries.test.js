import assert from 'node:assert'
import { prisma } from '../src/config/database.js'

const BASE_URL = 'http://localhost:5001/api/v1'

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return {
    status: res.status,
    ok: res.ok,
    data
  }
}

async function runTests() {
  console.log('--- STARTING ENTERPRISE CONTACT INQUIRIES TEST ---')

  // Setup: Register and promote test admin
  const testAdminEmail = `admin_test_${Date.now()}@studio.local`
  const password = 'SecurePassword123!'
  const adminRegRes = await request(`${BASE_URL}/auth/register`, {
    method: 'POST',
    body: {
      email: testAdminEmail,
      password,
      fullName: 'Admin Tester'
    }
  })
  const adminId = adminRegRes.data.data.user.id
  await prisma.user.update({
    where: { id: adminId },
    data: { role: 'ADMIN' }
  })
  const adminLoginRes = await request(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body: {
      email: testAdminEmail,
      password,
      requestedAdmin: true
    }
  })
  const adminToken = adminLoginRes.data.data.accessToken
  assert(adminToken, 'Admin token must be returned')

  // Setup: Register or log in a customer user for testing role authorization
  const testCustomerEmail = `customer_test_${Date.now()}@studio.local`
  const customerRegRes = await request(`${BASE_URL}/auth/register`, {
    method: 'POST',
    body: {
      email: testCustomerEmail,
      password,
      fullName: 'Test Customer'
    }
  })
  const customerToken = customerRegRes.data?.data?.token || customerRegRes.data?.data?.accessToken
  assert(customerToken, 'Customer token must be returned')

  // 1. SECURITY: Unauthenticated Submission Rejected
  console.log('1. Testing unauthenticated consultation inquiry submission (must be 401)...')
  const testEmail = `enterprise_test_${Date.now()}@testcompany.org`
  const unauthSubmitRes = await request(`${BASE_URL}/contact/inquiries`, {
    method: 'POST',
    body: {
      fullName: 'David Sterling',
      email: testEmail,
      companyName: 'Sterling Visual FX',
      message: 'Unauthenticated attempt'
    }
  })
  assert.strictEqual(unauthSubmitRes.status, 401, 'Unauthenticated POST must return 401')
  console.log('✓ Unauthenticated submission rejected with 401 UNAUTHORIZED')

  // 2. AUTHENTICATED CUSTOMER SUBMISSION: Valid Inquiry
  console.log('2. Testing authenticated customer consultation inquiry submission...')
  const submitRes = await request(`${BASE_URL}/contact/inquiries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: {
      fullName: 'David Sterling',
      email: testEmail,
      companyName: 'Sterling Visual FX',
      phone: '+1 415-555-0199',
      companySize: '51-200',
      service: 'both',
      monthlyUsage: '100k+',
      message: 'We are evaluating deploying Kiaan Studio across our 80-artist animation studio with dedicated GPU workers.'
    }
  })

  assert.strictEqual(submitRes.status, 201)
  assert.strictEqual(submitRes.data.success, true)
  assert(submitRes.data.data.id, 'Inquiry ID should be generated')
  assert.strictEqual(submitRes.data.data.companyName, 'Sterling Visual FX')
  assert.strictEqual(submitRes.data.data.status, 'NEW')
  const createdInquiryId = submitRes.data.data.id
  console.log('✓ Authenticated customer submission passed! Inquiry ID:', createdInquiryId)

  // 3. VALIDATION: Missing Required Fields
  console.log('3. Testing validation errors on missing fields...')
  const failRes = await request(`${BASE_URL}/contact/inquiries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: {
      fullName: '',
      email: 'invalid',
      companyName: '',
      message: 'short'
    }
  })
  assert.strictEqual(failRes.status, 400)
  console.log('✓ Missing field rejection passed (400)')

  // 4. DUPLICATE PREVENTION: Immediate resubmission of identical inquiry
  console.log('4. Testing duplicate inquiry rejection...')
  const dupRes = await request(`${BASE_URL}/contact/inquiries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: {
      fullName: 'David Sterling',
      email: testEmail,
      companyName: 'Sterling Visual FX',
      message: 'We are evaluating deploying Kiaan Studio across our 80-artist animation studio with dedicated GPU workers.'
    }
  })
  assert.strictEqual(dupRes.status, 409)
  assert.strictEqual(dupRes.data.error?.code, 'DUPLICATE_INQUIRY')
  console.log('✓ Duplicate submission rejection passed (409 DUPLICATE_INQUIRY)')

  // 4. SECURITY: Unauthorized access to Admin Inquiries
  console.log('4. Testing security: unauthenticated access to admin inquiries...')
  const unauthRes = await request(`${BASE_URL}/admin/inquiries`)
  assert.strictEqual(unauthRes.status, 401)
  console.log('✓ Unauthenticated request rejected (401)')

  console.log('5. Testing security: customer role access to admin inquiries...')
  const forbiddenRes = await request(`${BASE_URL}/admin/inquiries`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  })
  assert.strictEqual(forbiddenRes.status, 403)
  console.log('✓ Customer role rejected (403 Forbidden)')

  // 5. ADMIN LISTING: Admin views submitted inquiries
  console.log('6. Testing admin listing of inquiries...')
  const adminListRes = await request(`${BASE_URL}/admin/inquiries`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  assert.strictEqual(adminListRes.status, 200)
  assert.strictEqual(adminListRes.data.success, true)
  assert(Array.isArray(adminListRes.data.data.inquiries), 'Inquiries array returned')
  assert(adminListRes.data.data.counts, 'Counts object returned')
  assert(adminListRes.data.data.counts.total >= 1, 'Total counts should be >= 1')
  console.log('✓ Admin listing passed! Total inquiries:', adminListRes.data.data.counts.total)

  // 6. ADMIN GET DETAILS: Admin views single inquiry details
  console.log('7. Testing admin get inquiry by ID...')
  const adminDetailRes = await request(`${BASE_URL}/admin/inquiries/${createdInquiryId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  assert.strictEqual(adminDetailRes.status, 200)
  assert.strictEqual(adminDetailRes.data.data.id, createdInquiryId)
  assert.strictEqual(adminDetailRes.data.data.fullName, 'David Sterling')
  assert.strictEqual(adminDetailRes.data.data.companyName, 'Sterling Visual FX')
  console.log('✓ Admin detail view passed')

  // 7. ADMIN UPDATE STATUS: Update to CONTACTED
  console.log('8. Testing admin status update to CONTACTED...')
  const updateRes = await request(
    `${BASE_URL}/admin/inquiries/${createdInquiryId}/status`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        status: 'CONTACTED',
        notes: 'Scheduled discovery call with Lead Architect for Thursday 2pm.'
      }
    }
  )
  assert.strictEqual(updateRes.status, 200)
  assert.strictEqual(updateRes.data.data.status, 'CONTACTED')
  assert.strictEqual(updateRes.data.data.notes, 'Scheduled discovery call with Lead Architect for Thursday 2pm.')
  console.log('✓ Admin status update to CONTACTED passed')

  // 8. ADMIN FILTERING: Filter by CONTACTED
  console.log('9. Testing admin status filtering...')
  const filterRes = await request(`${BASE_URL}/admin/inquiries?status=CONTACTED`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  assert.strictEqual(filterRes.status, 200)
  const found = filterRes.data.data.inquiries.some((inq) => inq.id === createdInquiryId)
  assert(found, 'Updated inquiry should appear in CONTACTED filter')
  console.log('✓ Status filtering passed')

  console.log('--- ALL ENTERPRISE INQUIRIES TESTS PASSED SUCCESSFULLY! ---')
}

runTests()
  .catch((err) => {
    console.error('Test Failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
