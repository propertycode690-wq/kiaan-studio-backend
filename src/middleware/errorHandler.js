import { apiResponse } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = []) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    Error.captureStackTrace(this, this.constructor)
  }
}

export function errorHandler(err, req, res, next) {
  logger.error(`Unhandled Exception: ${err.message}`, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  })

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'
  const code = err.code || 'INTERNAL_ERROR'
  const details = err.details || []

  return apiResponse.error(res, message, statusCode, code, details)
}

export default errorHandler
