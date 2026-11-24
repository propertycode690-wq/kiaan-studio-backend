import { Router } from 'express'
import { SubscriptionsController } from './subscriptions.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// Public plan catalog
router.get('/plans', SubscriptionsController.listPlans)

// Webhook listener
router.post('/webhook', SubscriptionsController.handleWebhook)

// Authenticated customer endpoints
router.use(authenticate)

router.get('/current', SubscriptionsController.getCurrentSubscription)
router.post('/orders', SubscriptionsController.createOrder)
router.get('/invoices', SubscriptionsController.listInvoices)

export default router
