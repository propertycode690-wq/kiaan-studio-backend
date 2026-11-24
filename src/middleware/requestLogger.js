import { logger } from '../utils/logger.js'

export function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, originalUrl } = req

  res.on('finish', () => {
    const duration = Date.now() - start
    const { statusCode } = res
    logger.info(`${method} ${originalUrl} ${statusCode} - ${duration}ms`)
  })

  next()
}

export default requestLogger
