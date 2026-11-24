import { apiResponse } from '../../utils/apiResponse.js'
import { normalizeEmail } from './auth.utils.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegister(req, res, next) {
  const { email, password, fullName } = req.body

  const errors = []

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
    errors.push({ field: 'fullName', message: 'Full name must be at least 2 characters long' })
  }

  const normalized = normalizeEmail(email)
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    errors.push({ field: 'email', message: 'A valid email address is required' })
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push({ field: 'password', message: 'Password must be at least 8 characters long' })
  }

  if (errors.length > 0) {
    return apiResponse.error(res, 'Validation failed', 400, 'VALIDATION_ERROR', errors)
  }

  req.body.email = normalized
  req.body.fullName = fullName.trim()
  next()
}

export function validateLogin(req, res, next) {
  const { email, password } = req.body

  const errors = []
  const normalized = normalizeEmail(email)

  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    errors.push({ field: 'email', message: 'A valid email address is required' })
  }

  if (!password || typeof password !== 'string') {
    errors.push({ field: 'password', message: 'Password is required' })
  }

  if (errors.length > 0) {
    return apiResponse.error(res, 'Validation failed', 400, 'VALIDATION_ERROR', errors)
  }

  req.body.email = normalized
  next()
}
