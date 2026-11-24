import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import { env } from './config/env.js'
import { requestLogger } from './middleware/requestLogger.js'
import { notFoundHandler } from './middleware/notFoundHandler.js'
import { errorHandler } from './middleware/errorHandler.js'

// Import Domain Module Routers
import authRoutes from './modules/auth/auth.routes.js'
import usersRoutes from './modules/users/users.routes.js'
import customerRoutes from './modules/customer/customer.routes.js'
import adminRoutes from './modules/admin/admin.routes.js'
import projectsRoutes from './modules/projects/projects.routes.js'
import assetsRoutes from './modules/assets/assets.routes.js'
import generationRoutes from './modules/generation/generation.routes.js'
import creditsRoutes from './modules/credits/credits.routes.js'
import subscriptionsRoutes from './modules/subscriptions/subscriptions.routes.js'
import supportRoutes from './modules/support/support.routes.js'
import contactRoutes from './modules/contact/contact.routes.js'

export const app = express()

// 1. Security & Network Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin) return callback(null, true)
      // Allow localhost or 127.0.0.1 on any port and FRONTEND_URL
      if (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        origin === env.FRONTEND_URL
      ) {
        return callback(null, true)
      }
      return callback(null, true)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      'Accept',
      'Origin',
      'X-Requested-With'
    ]
  })
)

// 2. Body Parsing & Cookie Middleware
app.use(cookieParser())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 3. Request Logging
app.use(requestLogger)

// Ensure upload directories exist (compatible with Railway volume mount)
const uploadSubdirs = ['generations', 'references', 'avatars', 'inputs']
for (const sub of uploadSubdirs) {
  const dir = path.join(env.UPLOADS_DIR, sub)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Static file serving for uploads & media (supports Railway persistent volume)
app.use('/uploads', express.static(env.UPLOADS_DIR))

// 4. Working Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: '1.0.0'
  })
})

// 5. Modular Domain Routers (/api/v1)
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/users', usersRoutes)
app.use('/api/v1/customer', customerRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/projects', projectsRoutes)
app.use('/api/v1/assets', assetsRoutes)
app.use('/api/v1/generation', generationRoutes)
app.use('/api/v1/credits', creditsRoutes)
app.use('/api/v1/subscriptions', subscriptionsRoutes)
app.use('/api/v1/support', supportRoutes)
app.use('/api/v1/contact', contactRoutes)

// 6. Catch-All & Error Handling
app.use(notFoundHandler)
app.use(errorHandler)

export default app
