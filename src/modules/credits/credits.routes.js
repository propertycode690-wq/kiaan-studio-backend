import { Router } from 'express'
import { CreditsController } from './credits.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// Public pricing endpoint
router.get('/pricing', CreditsController.getPricing)

// Authenticated endpoints
router.use(authenticate)

router.get('/balance', CreditsController.getBalance)
router.get('/usage-history', CreditsController.getUsageHistory)
router.get('/transactions', CreditsController.getTransactions)
router.post('/topup', CreditsController.createTopUpOrder)

export default router
