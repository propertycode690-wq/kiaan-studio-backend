import { Router } from 'express'
import { ContactController } from './contact.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

/**
 * Authenticated route for submitting enterprise consultation inquiries
 * POST /api/v1/contact/inquiries
 */
router.post('/inquiries', authenticate, ContactController.submitInquiry)

export default router
