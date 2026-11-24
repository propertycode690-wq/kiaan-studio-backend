import { Router } from 'express'
import { CustomerController } from './customer.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All customer routes require authentication
router.use(authenticate)

router.get('/dashboard/overview', CustomerController.getOverview)
router.get('/overview', CustomerController.getOverview)

router.get('/downloads', CustomerController.getDownloads)
router.post('/downloads', CustomerController.recordDownload)
router.delete('/downloads', CustomerController.clearDownloads)
router.delete('/downloads/:id', CustomerController.deleteDownload)

export default router
