import { Router } from 'express'
import { UsersController } from './users.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All user endpoints require authentication
router.use(authenticate)

router.get('/profile', UsersController.getProfile)
router.patch('/profile', UsersController.updateProfile)
router.put('/password', UsersController.changePassword)
router.post('/change-password', UsersController.changePassword)

router.get('/preferences', UsersController.getPreferences)
router.put('/preferences', UsersController.updatePreferences)

router.get('/api-keys', UsersController.listApiKeys)
router.post('/api-keys', UsersController.createApiKey)
router.delete('/api-keys/:keyId', UsersController.deleteApiKey)

export default router
