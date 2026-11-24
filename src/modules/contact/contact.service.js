import { prisma } from '../../config/database.js'
import { AppError } from '../../middleware/errorHandler.js'

export class ContactService {
  /**
   * Submit a new enterprise architecture consultation request.
   * Requires authenticated customer user. Includes spam prevention, field validation, and duplicate detection.
   */
  static async submitInquiry(data, clientIp = null, authUser = null) {
    if (!authUser || !authUser.id) {
      throw new AppError(
        'Authentication required. Please sign in to submit an enterprise consultation inquiry.',
        401,
        'UNAUTHORIZED'
      )
    }

    const {
      fullName,
      email,
      companyName,
      phone,
      companySize,
      service,
      monthlyUsage,
      message,
      honeypot
    } = data

    // 1. Honeypot check for automated bot spam
    if (honeypot && String(honeypot).trim().length > 0) {
      throw new AppError('Spam submission detected.', 400, 'SPAM_REJECTED')
    }

    // 2. Validate required fields
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      throw new AppError('Full name is required.', 400, 'INVALID_NAME')
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new AppError('Business email is required.', 400, 'INVALID_EMAIL')
    }
    const cleanEmail = email.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail)) {
      throw new AppError('Please provide a valid business email address.', 400, 'INVALID_EMAIL_FORMAT')
    }

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      throw new AppError('Company or agency name is required.', 400, 'INVALID_COMPANY')
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new AppError('Project requirements or message is required.', 400, 'INVALID_MESSAGE')
    }
    const cleanMessage = message.trim()
    if (cleanMessage.length < 15) {
      throw new AppError('Please provide at least 15 characters describing your requirements.', 400, 'MESSAGE_TOO_SHORT')
    }

    // 3. Duplicate Prevention: Check identical email & message within last 5 minutes
    const recentDuplicate = await prisma.enterpriseInquiry.findFirst({
      where: {
        email: cleanEmail,
        message: cleanMessage,
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000)
        }
      }
    })
    if (recentDuplicate) {
      throw new AppError(
        'A duplicate consultation request was recently submitted. Our architecture team is already reviewing your details.',
        409,
        'DUPLICATE_INQUIRY'
      )
    }

    // 4. Rate Limiting per IP: Max 5 submissions per hour
    if (clientIp) {
      const recentCount = await prisma.enterpriseInquiry.count({
        where: {
          ipAddress: clientIp,
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000)
          }
        }
      })
      if (recentCount >= 5) {
        throw new AppError(
          'Too many consultation requests received from this network. Please try again later or reach out via our official support desk.',
          429,
          'RATE_LIMIT_EXCEEDED'
        )
      }
    }

    // 5. Create database record
    const inquiry = await prisma.enterpriseInquiry.create({
      data: {
        userId: authUser.id,
        fullName: fullName.trim().slice(0, 120),
        email: cleanEmail.slice(0, 191),
        companyName: companyName.trim().slice(0, 191),
        phone: phone && typeof phone === 'string' ? phone.trim().slice(0, 50) : null,
        companySize: (companySize || '11-50').trim().slice(0, 50),
        service: (service || 'both').trim().slice(0, 100),
        monthlyUsage: (monthlyUsage || '25k-100k').trim().slice(0, 100),
        message: cleanMessage.slice(0, 5000),
        status: 'NEW',
        ipAddress: clientIp ? String(clientIp).slice(0, 45) : null
      }
    })

    return {
      id: inquiry.id,
      fullName: inquiry.fullName,
      email: inquiry.email,
      companyName: inquiry.companyName,
      status: inquiry.status,
      createdAt: inquiry.createdAt
    }
  }

  /**
   * Admin: List consultation inquiries with filters, search, and pagination.
   */
  static async listInquiries(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
    const skip = (page - 1) * limit

    const where = {}

    // Filter by status (NEW, CONTACTED, CLOSED)
    if (query.status && ['NEW', 'CONTACTED', 'CLOSED'].includes(query.status.toUpperCase())) {
      where.status = query.status.toUpperCase()
    }

    // Search filter across name, email, company, phone
    if (query.search && query.search.trim()) {
      const term = query.search.trim()
      where.OR = [
        { fullName: { contains: term } },
        { email: { contains: term } },
        { companyName: { contains: term } },
        { phone: { contains: term } }
      ]
    }

    const inquiryDelegate = prisma.enterpriseInquiry || prisma.EnterpriseInquiry

    if (!inquiryDelegate || typeof inquiryDelegate.findMany !== 'function') {
      return {
        inquiries: [],
        counts: { total: 0, new: 0, contacted: 0, closed: 0 },
        pagination: { total: 0, page, limit, totalPages: 1 }
      }
    }

    const [inquiries, total] = await Promise.all([
      inquiryDelegate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      inquiryDelegate.count({ where })
    ])

    // Compute status counts for admin KPI badges
    const [newCount, contactedCount, closedCount] = await Promise.all([
      inquiryDelegate.count({ where: { status: 'NEW' } }),
      inquiryDelegate.count({ where: { status: 'CONTACTED' } }),
      inquiryDelegate.count({ where: { status: 'CLOSED' } })
    ])

    return {
      inquiries,
      counts: {
        total: newCount + contactedCount + closedCount,
        new: newCount,
        contacted: contactedCount,
        closed: closedCount
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Admin: Get full details of a specific consultation inquiry.
   */
  static async getInquiryById(id) {
    const inquiryDelegate = prisma.enterpriseInquiry || prisma.EnterpriseInquiry
    if (!inquiryDelegate) {
      throw new AppError('Consultation inquiry not found.', 404, 'INQUIRY_NOT_FOUND')
    }
    const inquiry = await inquiryDelegate.findUnique({
      where: { id }
    })
    if (!inquiry) {
      throw new AppError('Consultation inquiry not found.', 404, 'INQUIRY_NOT_FOUND')
    }
    return inquiry
  }

  /**
   * Admin: Update inquiry status and internal notes.
   */
  static async updateInquiryStatus(id, { status, notes }, adminUser = null) {
    const validStatuses = ['NEW', 'CONTACTED', 'CLOSED']
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      throw new AppError('Invalid status. Allowed values: NEW, CONTACTED, CLOSED.', 400, 'INVALID_STATUS')
    }

    const inquiryDelegate = prisma.enterpriseInquiry || prisma.EnterpriseInquiry
    if (!inquiryDelegate) {
      throw new AppError('Consultation inquiry not found.', 404, 'INQUIRY_NOT_FOUND')
    }

    const existing = await inquiryDelegate.findUnique({
      where: { id }
    })
    if (!existing) {
      throw new AppError('Consultation inquiry not found.', 404, 'INQUIRY_NOT_FOUND')
    }

    const updated = await inquiryDelegate.update({
      where: { id },
      data: {
        status: status.toUpperCase(),
        ...(notes !== undefined && { notes: notes ? String(notes).trim() : null })
      }
    })

    // Create Audit Log record if admin user provided
    if (adminUser?.id) {
      await prisma.auditLog.create({
        data: {
          actorId: adminUser.id,
          action: 'UPDATE_INQUIRY_STATUS',
          targetEntity: 'EnterpriseInquiry',
          targetId: id,
          diffJson: {
            previousStatus: existing.status,
            newStatus: updated.status,
            notesUpdated: notes !== undefined
          }
        }
      }).catch(() => {})
    }

    return updated
  }
}

export default ContactService
