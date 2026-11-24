import { SupportService } from './support.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class SupportController {
  static async createTicket(req, res, next) {
    try {
      const ticket = await SupportService.createTicket(req.user.id, req.body)
      return apiResponse.created(res, ticket, 'Support ticket created successfully')
    } catch (error) {
      next(error)
    }
  }

  static async listUserTickets(req, res, next) {
    try {
      const tickets = await SupportService.listUserTickets(req.user.id)
      return apiResponse.success(res, tickets)
    } catch (error) {
      next(error)
    }
  }

  static async getUserTicket(req, res, next) {
    try {
      const ticket = await SupportService.getUserTicket(req.user.id, req.params.id)
      return apiResponse.success(res, ticket)
    } catch (error) {
      next(error)
    }
  }

  static async addUserReply(req, res, next) {
    try {
      const reply = await SupportService.addUserReply(req.user.id, req.params.id, req.body.message)
      return apiResponse.created(res, reply, 'Reply added successfully')
    } catch (error) {
      next(error)
    }
  }

  // Admin handlers
  static async listAllTickets(req, res, next) {
    try {
      const data = await SupportService.listAllTickets(req.query)
      return apiResponse.success(res, data)
    } catch (error) {
      next(error)
    }
  }

  static async getAdminTicket(req, res, next) {
    try {
      const ticket = await SupportService.getTicketById(req.params.id)
      return apiResponse.success(res, ticket)
    } catch (error) {
      next(error)
    }
  }

  static async addAdminReply(req, res, next) {
    try {
      const reply = await SupportService.addAdminReply(
        req.user.id,
        req.params.id,
        req.body.message,
        req.body.status
      )
      return apiResponse.created(res, reply, 'Admin reply sent successfully')
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
}
