import { app } from './app.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'
import { prisma } from './config/database.js'
import { CloudflareWorkerDaemon } from './modules/generation/cloudflareWorker.js'

const server = app.listen(env.PORT, () => {
  logger.info(`====================================================`)
  logger.info(` KIAAN STUDIO BACKEND API FOUNDATION READY`)
  logger.info(` Environment : ${env.NODE_ENV}`)
  logger.info(` Port        : ${env.PORT}`)
  logger.info(` Health Check: http://localhost:${env.PORT}/api/health`)
  logger.info(` API Base    : http://localhost:${env.PORT}/api/v1`)
  logger.info(` Frontend    : ${env.FRONTEND_URL}`)
  logger.info(` AI Worker   : ${env.ENABLE_AI_WORKER ? 'ACTIVE (Cloudflare AI Daemon)' : 'OFFLINE'}`)
  logger.info(`====================================================`)

  if (env.ENABLE_AI_WORKER) {
    CloudflareWorkerDaemon.startWorkerDaemon({ intervalMs: 2000 })
  }
})

// Graceful shutdown handling
const handleGracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down HTTP server...`)
  CloudflareWorkerDaemon.stopWorkerDaemon()
  server.close(async () => {
    logger.info('HTTP server closed.')
    try {
      await prisma.$disconnect()
      logger.info('Prisma client disconnected successfully.')
    } catch (err) {
      logger.error('Error during Prisma disconnect', { error: err.message })
    }
    process.exit(0)
  })

  // Force shutdown after 10 seconds timeout
  setTimeout(() => {
    logger.error('Forced shutdown timeout reached. Terminating process.')
    process.exit(1)
  }, 10000)
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'))
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'))

export default server
