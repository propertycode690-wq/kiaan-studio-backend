import { Router } from 'express'
import { AuthController } from './auth.controller.js'
import { validateRegister, validateLogin } from './auth.validation.js'
import { authRateLimiter } from '../../middleware/rateLimiter.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

/**
 * Public Authentication Endpoints
 */
router.post('/register', validateRegister, authRateLimiter, AuthController.register)
router.post('/login', validateLogin, authRateLimiter, AuthController.login)
router.post('/refresh', AuthController.refresh)
router.post('/logout', AuthController.logout)

/**
 * Authenticated Identity Endpoints
 */
router.get('/me', authenticate, AuthController.getMe)

export default router
