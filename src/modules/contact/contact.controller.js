import { ContactService } from './contact.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class ContactController {
  /**
   * Authenticated: Submit enterprise consultation inquiry
   * POST /api/v1/contact/inquiries
   */
  static async submitInquiry(req, res, next) {
    try {
      const clientIp =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        null

      const result = await ContactService.submitInquiry(req.body, clientIp, req.user)
      return apiResponse.created(
        res,
        result,
        'Your enterprise consultation inquiry has been submitted successfully. Our team will contact you shortly.'
      )
    } catch (error) {
      next(error)
    }
  }

  /**
   * Admin: List all enterprise consultation inquiries
   * GET /api/v1/admin/inquiries
   */
  static async listInquiries(req, res, next) {
    try {
      const result = await ContactService.listInquiries(req.query)
      return apiResponse.success(res, result)
    } catch (error) {
      next(error)
    }
  }

  /**
   * Admin: Get inquiry details
   * GET /api/v1/admin/inquiries/:id
   */
  static async getInquiryById(req, res, next) {
    try {
      const result = await ContactService.getInquiryById(req.params.id)
      return apiResponse.success(res, result)
    } catch (error) {
      next(error)
    }
  }

  /**
   * Admin: Update inquiry status & notes
   * PATCH /api/v1/admin/inquiries/:id/status
   */
  static async updateInquiryStatus(req, res, next) {
    try {
      const result = await ContactService.updateInquiryStatus(
        req.params.id,
        req.body,
        req.user
      )
      return apiResponse.success(
        res,
        result,
        'Inquiry status updated successfully.'
      )
    } catch (error) {
      next(error)
    }
  }
}

export default ContactController
