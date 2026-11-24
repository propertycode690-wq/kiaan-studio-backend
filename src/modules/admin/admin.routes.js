import { Router } from 'express'
import { AdminController } from './admin.controller.js'
import { ContactController } from '../contact/contact.controller.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { apiResponse } from '../../utils/apiResponse.js'

const router = Router()

// Public / Health check for admin module
router.get('/status', (req, res) => {
  return apiResponse.success(res, { module: 'admin', status: 'operational' })
})

// All subsequent routes require Authentication + ADMIN or SUPER_ADMIN role
router.use(authenticate)
router.use(authorize('ADMIN', 'SUPER_ADMIN'))

// 1. Overview & Analytics
router.get('/dashboard', AdminController.getOverview)
router.get('/overview', AdminController.getOverview)
router.get('/analytics', AdminController.getAnalytics)

// 2. User Management
router.get('/users', AdminController.listUsers)
router.get('/users/:id', AdminController.getUserDetails)
router.patch('/users/:id', AdminController.updateUser)
router.patch('/users/:id/status', AdminController.updateUserStatus)
router.patch('/users/:id/role', AdminController.updateUserRole)
router.post('/users/:id/credits', AdminController.adjustUserCredits)

// 3. Generation Jobs & Queue
router.get('/jobs', AdminController.listJobs)
router.get('/queue', AdminController.getQueueMetrics)
router.get('/jobs/failed', AdminController.getFailedJobs)
router.post('/jobs/:id/cancel', AdminController.cancelJob)
router.post('/jobs/:id/retry', AdminController.retryJob)

// 4. GPU Hardware Nodes
router.get('/gpu/nodes', AdminController.listGpuNodes)
router.post('/gpu/nodes', AdminController.registerOrHeartbeatGpuNode)
router.patch('/gpu/nodes/:id', AdminController.updateGpuNode)
router.delete('/gpu/nodes/:id', AdminController.deleteGpuNode)
router.post('/gpu/nodes/:id/heartbeat', AdminController.registerOrHeartbeatGpuNode)

// 5. AI Models Catalog
router.get('/models', AdminController.listModels)
router.patch('/models/:id', AdminController.updateModel)

// 6. Subscription Plans & Revenue
router.get('/plans', AdminController.listPlans)
router.patch('/plans/:id', AdminController.updatePlan)
router.get('/invoices', AdminController.listInvoices)
router.get('/revenue', AdminController.getRevenueReport)

// 7. Credits Distribution & Ledger
router.get('/credits', AdminController.getCreditsOverview)

// 8. Support Tickets
router.get('/support/tickets', AdminController.listSupportTickets)
router.get('/support/tickets/:id', AdminController.getSupportTicket)
router.post('/support/tickets/:id/messages', AdminController.addSupportReply)
router.patch('/support/tickets/:id/status', AdminController.updateTicketStatus)

// 9. Audit Logging
router.get('/audit-logs', AdminController.listAuditLogs)

// 10. System Settings
router.get('/settings', AdminController.getSystemSettings)
router.put('/settings', AdminController.updateSystemSettings)

// 11. Enterprise Architecture Inquiries
router.get('/inquiries', ContactController.listInquiries)
router.get('/inquiries/:id', ContactController.getInquiryById)
router.patch('/inquiries/:id/status', ContactController.updateInquiryStatus)

export default router
