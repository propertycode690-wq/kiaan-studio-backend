import { prisma } from '../../config/database.js'
import { logger } from '../../utils/logger.js'

export class AuditService {
  /**
   * Record an administrative or security audit event in the database.
   * @param {Object} params
   * @param {string} params.actorId - User ID of the administrator
   * @param {string} params.action - Action name (e.g., 'USER_STATUS_UPDATE', 'CREDIT_ADJUSTMENT')
   * @param {string} params.targetEntity - Entity affected ('USER', 'GPU_NODE', 'AI_MODEL', 'SUBSCRIPTION_PLAN', 'JOB')
   * @param {string} [params.targetId] - Target ID
   * @param {string} [params.ipAddress] - IP address of the request
   * @param {Object} [params.diffJson] - JSON payload describing changes (before/after/reason)
   */
  static async log({ actorId, action, targetEntity, targetId = null, ipAddress = null, diffJson = null }) {
    try {
      return await prisma.auditLog.create({
        data: {
          actorId,
          action,
          targetEntity,
          targetId: targetId ? String(targetId) : null,
          ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
          diffJson: diffJson || {}
        }
      })
    } catch (error) {
      logger.error('Failed to create audit log entry:', error)
      // Audit log failures should not crash user-facing actions, but must be logged
      return null
    }
  }

  /**
   * Query audit logs with pagination and filters
   */
  static async listLogs({ page = 1, limit = 20, action = null, actorId = null, targetEntity = null } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const where = {}
    if (action) where.action = action
    if (actorId) where.actorId = actorId
    if (targetEntity) where.targetEntity = targetEntity

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true
            }
          }
        }
      })
    ])

    return {
      logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }
}
