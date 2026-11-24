import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { apiResponse } from '../utils/apiResponse.js'

const DEFAULT_WORKER_SECRET = process.env.WORKER_SECRET || 'kiaan_worker_secret_dev_2026'

/**
 * Middleware ensuring worker endpoints can only be accessed by authorized
 * worker daemons or administrators, and NEVER by ordinary customer tokens.
 */
export function requireWorkerAuth(req, res, next) {
  const authHeader = req.headers.authorization
  const workerKey = req.headers['x-worker-key'] || req.headers['x-worker-secret']

  // 1. If a Bearer token is passed, verify if it's a customer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]

    // If it matches the pre-shared worker secret directly
    if (token === DEFAULT_WORKER_SECRET) {
      req.worker = { authenticated: true, source: 'worker_secret' }
      return next()
    }

    // Try decoding as JWT
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET)
      if (decoded.role === 'CREATOR' || decoded.role === 'CUSTOMER') {
        return apiResponse.error(
          res,
          'Customer accounts are not authorized to access internal worker endpoints',
          403,
          'FORBIDDEN_WORKER_ACCESS'
        )
      }

      if (['ADMIN', 'SUPER_ADMIN'].includes(decoded.role)) {
        req.worker = { authenticated: true, source: 'admin_jwt', user: decoded }
        return next()
      }
    } catch (err) {
      // If token is invalid JWT and doesn't match worker secret
      if (workerKey !== DEFAULT_WORKER_SECRET) {
        return apiResponse.error(res, 'Invalid worker authorization token', 401, 'UNAUTHORIZED')
      }
    }
  }

  // 2. Pre-shared worker API key via header
  if (workerKey && workerKey === DEFAULT_WORKER_SECRET) {
    req.worker = { authenticated: true, source: 'worker_key' }
    return next()
  }

  // 3. In development/testing, allow internal worker calls if not explicitly spoofed by a customer token
  if (process.env.NODE_ENV !== 'production' && !authHeader) {
    req.worker = { authenticated: true, source: 'local_dev' }
    return next()
  }

  return apiResponse.error(
    res,
    'Worker authentication required. Provide x-worker-key or worker credentials.',
    401,
    'WORKER_AUTH_REQUIRED'
  )
}

export default requireWorkerAuth
