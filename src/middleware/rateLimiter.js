import rateLimit from 'express-rate-limit'
import { apiResponse } from '../utils/apiResponse.js'
import { env } from '../config/env.js'

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isDevelopment ? 100 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return apiResponse.error(
      res,
      'Too many authentication attempts. Please try again after 15 minutes.',
      429,
      'RATE_LIMIT_EXCEEDED'
    )
  }
})

export default authRateLimiter
