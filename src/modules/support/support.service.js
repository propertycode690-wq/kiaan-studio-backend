import { prisma } from '../../config/database.js'
import { AppError } from '../../middleware/errorHandler.js'
import { AuditService } from '../admin/audit.service.js'

export class SupportService {
  /**
   * Customer: Create a new support ticket with an initial message
   */
  static async createTicket(userId, { subject, category, priority = 'NORMAL', message }) {
    if (!subject || !subject.trim()) {
      throw new AppError('Subject is required', 400, 'MISSING_SUBJECT')
    }
    if (!message || !message.trim()) {
      throw new AppError('Message is required', 400, 'MISSING_MESSAGE')
    }

    const validPriority = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(priority.toUpperCase())
      ? priority.toUpperCase()
      : 'NORMAL'

    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        subject: subject.trim(),
        category: category || 'General',
        priority: validPriority,
        status: 'OPEN',
        messages: {
          create: {
            senderId: userId,
            message: message.trim()
          }
        }
      },
      include: {
        messages: {
          include: {
            sender: {
              select: { id: true, email: true, fullName: true, role: true }
            }
          }
        }
      }
    })

    return ticket
  }

  /**
   * Customer: List tickets belonging to the authenticated user
   */
  static async listUserTickets(userId) {
    return await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, email: true, fullName: true, role: true }
            }
          }
        }
      }
    })
  }

  /**
   * Customer: Get a specific owned ticket with full message thread
   */
  static async getUserTicket(userId, ticketId) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, email: true, fullName: true, role: true }
            }
          }
        }
      }
    })

    if (!ticket) {
      throw new AppError('Support ticket not found', 404, 'TICKET_NOT_FOUND')
    }

    return ticket
  }

  /**
   * Customer: Add a reply to own ticket
   */
  static async addUserReply(userId, ticketId, message) {
    if (!message || !message.trim()) {
      throw new AppError('Message body cannot be empty', 400, 'EMPTY_MESSAGE')
    }

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, userId }
    })

    if (!ticket) {
      throw new AppError('Support ticket not found', 404, 'TICKET_NOT_FOUND')
    }

    const [reply] = await prisma.$transaction([
      prisma.ticketMessage.create({
        data: {
          ticketId,
          senderId: userId,
          message: message.trim()
        },
        include: {
          sender: {
            select: { id: true, email: true, fullName: true, role: true }
          }
        }
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: ticket.status === 'CLOSED' ? 'OPEN' : ticket.status,
          updatedAt: new Date()
        }
      })
    ])

    return reply
  }

  // ===========================================================================
  // ADMIN SUPPORT CAPABILITIES
  // ===========================================================================

  /**
   * Admin: List all tickets across all customers
   */
  static async listAllTickets({ page = 1, limit = 20, status = '', category = '', priority = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const where = {}
    if (status) where.status = status.toUpperCase()
    if (category) where.category = category
    if (priority) where.priority = priority.toUpperCase()

    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, fullName: true, role: true }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          _count: {
            select: { messages: true }
          }
        }
      })
    ])

    return {
      tickets,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Admin: Get any ticket by ID
   */
  static async getTicketById(ticketId) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, role: true }
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, email: true, fullName: true, role: true }
            }
          }
        }
      }
    })

    if (!ticket) {
      throw new AppError('Support ticket not found', 404, 'TICKET_NOT_FOUND')
    }

    return ticket
  }

  /**
   * Admin: Reply to ticket
   */
  static async addAdminReply(actorId, ticketId, message, newStatus = null) {
    if (!message || !message.trim()) {
      throw new AppError('Reply message cannot be empty', 400, 'EMPTY_MESSAGE')
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId }
    })

    if (!ticket) {
      throw new AppError('Support ticket not found', 404, 'TICKET_NOT_FOUND')
    }

    const targetStatus = newStatus || 'OPEN'

    const [reply] = await prisma.$transaction([
      prisma.ticketMessage.create({
        data: {
          ticketId,
          senderId: actorId,
          message: message.trim()
        },
        include: {
          sender: {
            select: { id: true, email: true, fullName: true, role: true }
          }
        }
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: targetStatus,
          updatedAt: new Date()
        }
      })
    ])

    return reply
  }

  /**
   * Admin: Update ticket status
   */
  static async updateTicketStatus(actorId, ticketId, status, ipAddress) {
    const validStatus = ['OPEN', 'RESOLVED', 'CLOSED']
    if (!validStatus.includes(status.toUpperCase())) {
      throw new AppError('Invalid ticket status', 400, 'INVALID_STATUS')
    }

    const existing = await prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!existing) {
      throw new AppError('Support ticket not found', 404, 'TICKET_NOT_FOUND')
    }

    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: status.toUpperCase() }
    })

    await AuditService.log({
      actorId,
      action: 'TICKET_STATUS_UPDATE',
      targetEntity: 'SUPPORT_TICKET',
      targetId: ticketId,
      ipAddress,
      diffJson: { previousStatus: existing.status, newStatus: updated.status }
    })

    return updated
  }
}
