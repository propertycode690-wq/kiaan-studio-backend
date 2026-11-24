import { AdminService } from './admin.service.js'
import { AuditService } from './audit.service.js'
import { SupportService } from '../support/support.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class AdminController {
  // 1. Overview & Analytics
  static async getOverview(req, res, next) {
    try {
      const data = await AdminService.getOverviewStats()
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getAnalytics(req, res, next) {
    try {
      const data = await AdminService.getAnalytics(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  // 2. User Management
  static async listUsers(req, res, next) {
    try {
      const data = await AdminService.listUsers(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getUserDetails(req, res, next) {
    try {
      const data = await AdminService.getUserDetails(req.params.id)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async updateUser(req, res, next) {
    try {
      const user = await AdminService.updateUser(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, user, 'User updated successfully')
    } catch (error) {
      next(error)
    }
  }

  static async updateUserStatus(req, res, next) {
    try {
      const user = await AdminService.updateUserStatus(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, user, 'User status updated successfully')
    } catch (error) {
      next(error)
    }
  }

  static async updateUserRole(req, res, next) {
    try {
      const user = await AdminService.updateUserRole(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, user, 'User role updated successfully')
    } catch (error) {
      next(error)
    }
  }

  static async adjustUserCredits(req, res, next) {
    try {
      const result = await AdminService.adjustUserCredits(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, result, 'Credits adjusted successfully')
    } catch (error) {
      next(error)
    }
  }

  // 3. Generation Jobs & Queue
  static async listJobs(req, res, next) {
    try {
      const data = await AdminService.listJobs(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getQueueMetrics(req, res, next) {
    try {
      const data = await AdminService.getQueueMetrics()
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getFailedJobs(req, res, next) {
    try {
      const data = await AdminService.getFailedJobs(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async cancelJob(req, res, next) {
    try {
      const job = await AdminService.adminCancelJob(
        req.user.id,
        req.params.id,
        req.body?.reason,
        req.ip
      )
      return apiResponse.success(res, job, 'Job canceled and refunded if applicable')
    } catch (error) {
      next(error)
    }
  }

  static async retryJob(req, res, next) {
    try {
      const job = await AdminService.adminRetryJob(
        req.user.id,
        req.params.id,
        req.ip
      )
      return apiResponse.success(res, job, 'Job re-queued successfully')
    } catch (error) {
      next(error)
    }
  }

  // 4. GPU Nodes
  static async listGpuNodes(req, res, next) {
    try {
      const nodes = await AdminService.listGpuNodes()
      return apiResponse.success(res, nodes)
    } catch (error) {
      next(error)
    }
  }

  static async registerOrHeartbeatGpuNode(req, res, next) {
    try {
      const node = await AdminService.registerOrHeartbeatGpuNode(req.body)
      return apiResponse.success(res, node, 'Node registered / heartbeat accepted')
    } catch (error) {
      next(error)
    }
  }

  static async updateGpuNode(req, res, next) {
    try {
      const node = await AdminService.updateGpuNode(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, node, 'Node updated successfully')
    } catch (error) {
      next(error)
    }
  }

  static async deleteGpuNode(req, res, next) {
    try {
      const result = await AdminService.deleteGpuNode(req.user.id, req.params.id, req.ip)
      return apiResponse.success(res, result, 'Node removed successfully')
    } catch (error) {
      next(error)
    }
  }

  // 5. AI Models
  static async listModels(req, res, next) {
    try {
      const models = await AdminService.listModels()
      return apiResponse.success(res, models)
    } catch (error) {
      next(error)
    }
  }

  static async updateModel(req, res, next) {
    try {
      const model = await AdminService.updateModel(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, model, 'Model configuration updated')
    } catch (error) {
      next(error)
    }
  }

  // 6. Subscription Plans & Revenue
  static async listPlans(req, res, next) {
    try {
      const plans = await AdminService.listPlans()
      return apiResponse.success(res, plans)
    } catch (error) {
      next(error)
    }
  }

  static async updatePlan(req, res, next) {
    try {
      const plan = await AdminService.updatePlan(
        req.user.id,
        req.params.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, plan, 'Subscription plan updated')
    } catch (error) {
      next(error)
    }
  }

  static async listInvoices(req, res, next) {
    try {
      const data = await AdminService.listInvoices(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getRevenueReport(req, res, next) {
    try {
      const data = await AdminService.getRevenueReport()
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  // 7. Credits Overview & Ledger
  static async getCreditsOverview(req, res, next) {
    try {
      const data = await AdminService.getCreditsOverview(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  // 8. Support Tickets (Admin Views)
  static async listSupportTickets(req, res, next) {
    try {
      const data = await SupportService.listAllTickets(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getSupportTicket(req, res, next) {
    try {
      const ticket = await SupportService.getTicketById(req.params.id)
      return apiResponse.success(res, ticket)
    } catch (error) {
      next(error)
    }
  }

  static async addSupportReply(req, res, next) {
    try {
      const reply = await SupportService.addAdminReply(
        req.user.id,
        req.params.id,
        req.body.message,
        req.body.status
      )
      return apiResponse.created(res, reply, 'Reply added to ticket')
    } catch (error) {
      next(error)
    }
  }

  static async updateTicketStatus(req, res, next) {
    try {
      const updated = await SupportService.updateTicketStatus(
        req.user.id,
        req.params.id,
        req.body.status,
        req.ip
      )
      return apiResponse.success(res, updated, 'Ticket status updated')
    } catch (error) {
      next(error)
    }
  }

  // 9. Audit Logs
  static async listAuditLogs(req, res, next) {
    try {
      const data = await AuditService.listLogs(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  // 10. System Settings
  static async getSystemSettings(req, res, next) {
    try {
      const settings = await AdminService.getSystemSettings()
      return apiResponse.success(res, settings)
    } catch (error) {
      next(error)
    }
  }

  static async updateSystemSettings(req, res, next) {
    try {
      const settings = await AdminService.updateSystemSettings(
        req.user.id,
        req.body,
        req.ip
      )
      return apiResponse.success(res, settings, 'System settings updated successfully')
    } catch (error) {
      next(error)
    }
  }
}
