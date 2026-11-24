import { Router } from 'express'
import { SupportController } from './support.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All customer support routes require authentication
router.use(authenticate)

router.get('/tickets', SupportController.listUserTickets)
router.post('/tickets', SupportController.createTicket)
router.get('/tickets/:id', SupportController.getUserTicket)
router.post('/tickets/:id/messages', SupportController.addUserReply)

export default router
