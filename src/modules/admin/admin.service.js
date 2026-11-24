import { prisma } from '../../config/database.js'
import { AppError } from '../../middleware/errorHandler.js'
import { AuditService } from './audit.service.js'
import { logger } from '../../utils/logger.js'

export class AdminService {
  // ===========================================================================
  // 1. OVERVIEW & KPIS
  // ===========================================================================

  static async getOverviewStats() {
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

    const [
      totalUsers,
      activeUsers,
      totalJobs,
      completedJobs,
      failedJobs,
      queuedJobs,
      processingJobs,
      activeSubscriptions,
      paidInvoicesAgg,
      walletSum,
      consumedSum,
      gpuNodes,
      recentSignups,
      recentJobs
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.generationJob.count(),
      prisma.generationJob.count({ where: { status: 'COMPLETED' } }),
      prisma.generationJob.count({ where: { status: 'FAILED' } }),
      prisma.generationJob.count({ where: { status: { in: ['QUEUED', 'PENDING'] } } }),
      prisma.generationJob.count({ where: { status: 'PROCESSING' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID' }
      }),
      prisma.creditWallet.aggregate({
        _sum: { balance: true }
      }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'DEBIT', category: { in: ['IMAGE_GENERATION', 'VIDEO_GENERATION'] } }
      }),
      prisma.gpuNode.findMany({
        orderBy: { lastHeartbeatAt: 'desc' }
      }),
      prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          createdAt: true,
          wallet: { select: { balance: true } }
        }
      }),
      prisma.generationJob.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, fullName: true }
          }
        }
      })
    ])

    // Compute online GPU nodes (heartbeat within 5 minutes and not OFFLINE)
    const activeGpuNodes = gpuNodes.filter(
      (node) => node.status !== 'OFFLINE' && new Date(node.lastHeartbeatAt) >= fiveMinutesAgo
    ).length

    const confirmedRevenue = Number(paidInvoicesAgg._sum.amount || 0)
    const totalCreditsCirculating = walletSum._sum.balance || 0
    const totalCreditsBurned = consumedSum._sum.amount || 0

    return {
      kpis: {
        totalUsers,
        activeUsers,
        activeGpuFleet: activeGpuNodes,
        totalGpuNodes: gpuNodes.length,
        activeQueues: queuedJobs + processingJobs,
        queuedJobs,
        processingJobs,
        completedJobs,
        failedJobs,
        totalJobs,
        activeSubscriptions,
        platformRevenue: confirmedRevenue,
        creditsCirculating: totalCreditsCirculating,
        creditsBurned: totalCreditsBurned
      },
      recentSignups: recentSignups.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        creditBalance: u.wallet?.balance || 0
      })),
      recentJobs: recentJobs.map((j) => ({
        id: j.id,
        type: j.type,
        modelId: j.modelId,
        status: j.status,
        creditCost: j.creditCost,
        createdAt: j.createdAt,
        user: j.user
      })),
      gpuFleetSummary: gpuNodes.map((n) => ({
        id: n.id,
        name: n.name,
        gpuModel: n.gpuModel,
        status: new Date(n.lastHeartbeatAt) < fiveMinutesAgo ? 'OFFLINE' : n.status,
        totalVramGb: n.totalVramGb,
        usedVramGb: n.usedVramGb,
        lastHeartbeatAt: n.lastHeartbeatAt
      }))
    }
  }

  // ===========================================================================
  // 2. ANALYTICS & TIME-SERIES
  // ===========================================================================

  static async getAnalytics({ days = 30 } = {}) {
    const daysNum = Math.min(90, Math.max(1, parseInt(days, 10) || 30))
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysNum)

    // Query jobs by type & status
    const jobs = await prisma.generationJob.findMany({
      where: { createdAt: { gte: startDate } },
      select: {
        id: true,
        type: true,
        status: true,
        creditCost: true,
        executionTimeMs: true,
        createdAt: true
      }
    })

    // Query confirmed revenue in range
    const invoices = await prisma.invoice.findMany({
      where: {
        status: 'PAID',
        createdAt: { gte: startDate }
      },
      select: {
        id: true,
        amount: true,
        createdAt: true
      }
    })

    // Grouping by date (YYYY-MM-DD)
    const dailyMap = {}
    for (let i = 0; i < daysNum; i++) {
      const d = new Date()
      d.setDate(d.getDate() - (daysNum - 1 - i))
      const key = d.toISOString().split('T')[0]
      dailyMap[key] = { date: key, jobsCount: 0, creditsBurned: 0, revenue: 0 }
    }

    jobs.forEach((job) => {
      const key = job.createdAt.toISOString().split('T')[0]
      if (dailyMap[key]) {
        dailyMap[key].jobsCount += 1
        if (job.status === 'COMPLETED') {
          dailyMap[key].creditsBurned += job.creditCost || 0
        }
      }
    })

    invoices.forEach((inv) => {
      const key = inv.createdAt.toISOString().split('T')[0]
      if (dailyMap[key]) {
        dailyMap[key].revenue += Number(inv.amount)
      }
    })

    const typeBreakdown = {
      TEXT_TO_IMAGE: 0,
      TEXT_TO_VIDEO: 0,
      IMAGE_TO_IMAGE: 0,
      IMAGE_EDITOR: 0,
      IMAGE_TO_VIDEO: 0
    }

    let totalExecutionTime = 0
    let completedCount = 0

    jobs.forEach((j) => {
      if (typeBreakdown[j.type] !== undefined) {
        typeBreakdown[j.type] += 1
      }
      if (j.status === 'COMPLETED' && j.executionTimeMs) {
        totalExecutionTime += j.executionTimeMs
        completedCount += 1
      }
    })

    const avgLatencyMs = completedCount > 0 ? Math.round(totalExecutionTime / completedCount) : 0

    return {
      timeframeDays: daysNum,
      dailyTrend: Object.values(dailyMap),
      typeBreakdown,
      performance: {
        totalJobs: jobs.length,
        completedJobs: completedCount,
        successRate: jobs.length > 0 ? Math.round((completedCount / jobs.length) * 100) : 100,
        avgLatencyMs
      }
    }
  }

  // ===========================================================================
  // 3. USER MANAGEMENT & RBAC
  // ===========================================================================

  static async listUsers({ page = 1, limit = 20, search = '', role = '', status = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const where = {}
    if (role) where.role = role
    if (status) where.status = status
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { fullName: { contains: search } }
      ]
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          avatarUrl: true,
          createdAt: true,
          wallet: {
            select: {
              id: true,
              balance: true,
              updatedAt: true
            }
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            take: 1,
            include: { plan: true }
          },
          _count: {
            select: {
              generationJobs: true,
              assets: true
            }
          }
        }
      })
    ])

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt,
        creditBalance: u.wallet?.balance || 0,
        activePlan: u.subscriptions[0]?.plan?.name || 'Free Tier',
        planSlug: u.subscriptions[0]?.plan?.slug || 'free',
        jobsCount: u._count.generationJobs,
        assetsCount: u._count.assets
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  static async getUserDetails(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
        wallet: {
          include: {
            transactions: {
              take: 20,
              orderBy: { createdAt: 'desc' }
            }
          }
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { plan: true }
        },
        generationJobs: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            generationJobs: true,
            assets: true,
            projects: true,
            invoices: true
          }
        }
      }
    })

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND')
    }

    return user
  }

  static async updateUser(actorId, userId, { fullName, role, status, creditDelta, reason }, ipAddress) {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true }
    })
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND')
    }

    const dataToUpdate = {}
    if (fullName !== undefined) {
      dataToUpdate.fullName = fullName.trim()
    }
    if (role) {
      if (role === 'SUPER_ADMIN' && existingUser.role !== 'SUPER_ADMIN') {
        throw new AppError('Assigning SUPER_ADMIN role is currently disabled for security', 403, 'SUPER_ADMIN_DISABLED')
      }
      if (['CREATOR', 'ADMIN'].includes(role)) {
        dataToUpdate.role = role
      }
    }
    if (status && ['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
      if (existingUser.id === actorId && status !== 'ACTIVE') {
        throw new AppError('Admins cannot suspend or ban their own account', 400, 'CANNOT_SUSPEND_SELF')
      }
      dataToUpdate.status = status
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate
    })

    // Immediate token revocation for banned/suspended accounts
    if (status === 'BANNED' || status === 'SUSPENDED') {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    }

    // Optional credit adjustment inside edit form
    let newCreditBalance = existingUser.wallet?.balance ?? 0
    if (creditDelta !== undefined && creditDelta !== '' && creditDelta !== null) {
      const delta = parseInt(creditDelta, 10)
      if (!isNaN(delta) && delta !== 0) {
        let wallet = existingUser.wallet
        if (!wallet) {
          wallet = await prisma.creditWallet.create({
            data: { userId, balance: 0 }
          })
        }
        newCreditBalance = wallet.balance + delta
        if (newCreditBalance < 0) {
          throw new AppError(
            `Credit deduction of ${Math.abs(delta)} exceeds current balance of ${wallet.balance}`,
            400,
            'INSUFFICIENT_CREDITS'
          )
        }
        await prisma.creditWallet.update({
          where: { userId },
          data: { balance: newCreditBalance }
        })
        await prisma.creditTransaction.create({
          data: {
            walletId: wallet.id,
            amount: Math.abs(delta),
            type: delta > 0 ? 'CREDIT' : 'DEBIT',
            category: 'ADMIN_GRANT',
            description: reason || 'Administrative credit adjustment via Edit form'
          }
        })
      }
    }

    await AuditService.log({
      actorId,
      action: 'USER_UPDATE',
      targetEntity: 'USER',
      targetId: userId,
      ipAddress,
      diffJson: {
        previous: {
          fullName: existingUser.fullName,
          role: existingUser.role,
          status: existingUser.status,
          creditBalance: existingUser.wallet?.balance ?? 0
        },
        updated: {
          ...dataToUpdate,
          ...(creditDelta ? { creditBalance: newCreditBalance } : {})
        },
        reason: reason || 'Administrative user profile update'
      }
    })

    return {
      ...updated,
      creditBalance: newCreditBalance
    }
  }

  static async updateUserStatus(actorId, userId, { status, reason }, ipAddress) {
    if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
      throw new AppError('Invalid user status', 400, 'INVALID_STATUS')
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND')
    }

    if (existingUser.id === actorId && status !== 'ACTIVE') {
      throw new AppError('Admins cannot suspend or ban their own account', 400, 'CANNOT_SUSPEND_SELF')
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status }
    })

    await AuditService.log({
      actorId,
      action: 'USER_STATUS_UPDATE',
      targetEntity: 'USER',
      targetId: userId,
      ipAddress,
      diffJson: {
        previousStatus: existingUser.status,
        newStatus: status,
        reason: reason || 'Administrative action'
      }
    })

    return updated
  }

  static async updateUserRole(actorId, userId, { role, reason }, ipAddress) {
    if (!['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      throw new AppError('Invalid role specified', 400, 'INVALID_ROLE')
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND')
    }

    if (role === 'SUPER_ADMIN' && existingUser.role !== 'SUPER_ADMIN') {
      throw new AppError('Assigning SUPER_ADMIN role is currently disabled for security', 403, 'SUPER_ADMIN_DISABLED')
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role }
    })

    await AuditService.log({
      actorId,
      action: 'USER_ROLE_UPDATE',
      targetEntity: 'USER',
      targetId: userId,
      ipAddress,
      diffJson: {
        previousRole: existingUser.role,
        newRole: role,
        reason: reason || 'Administrative role assignment'
      }
    })

    return updated
  }

  static async adjustUserCredits(actorId, userId, { amount, reason }, ipAddress) {
    const delta = parseInt(amount, 10)
    if (isNaN(delta) || delta === 0) {
      throw new AppError('Credit adjustment must be a non-zero integer', 400, 'INVALID_AMOUNT')
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true }
    })

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND')
    }

    let wallet = user.wallet
    if (!wallet) {
      wallet = await prisma.creditWallet.create({
        data: { userId, balance: 0 }
      })
    }

    const newBalance = wallet.balance + delta
    if (newBalance < 0) {
      throw new AppError(
        `Deduction of ${Math.abs(delta)} exceeds current balance of ${wallet.balance}`,
        400,
        'INSUFFICIENT_CREDITS'
      )
    }

    const transactionType = delta > 0 ? 'CREDIT' : 'DEBIT'
    const category = 'ADMIN_GRANT'

    const result = await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.creditWallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance }
      })

      const txRecord = await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          amount: Math.abs(delta),
          type: transactionType,
          category,
          description: reason || `Admin credit adjustment by ${actorId}`
        }
      })

      return { wallet: updatedWallet, transaction: txRecord }
    })

    await AuditService.log({
      actorId,
      action: 'CREDIT_ADJUSTMENT',
      targetEntity: 'USER',
      targetId: userId,
      ipAddress,
      diffJson: {
        delta,
        balanceBefore: wallet.balance,
        balanceAfter: newBalance,
        reason: reason || 'Administrative credit adjustment'
      }
    })

    return result
  }

  // ===========================================================================
  // 4. GENERATION JOBS & QUEUE ADMIN
  // ===========================================================================

  static async listJobs({ page = 1, limit = 20, type = '', status = '', modelId = '', search = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const where = {}
    if (type && type !== 'all') {
      const upperType = String(type).toUpperCase()
      if (upperType === 'IMAGE') {
        where.type = { in: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'IMAGE_EDITOR'] }
      } else if (upperType === 'VIDEO') {
        where.type = { in: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] }
      } else if (upperType.includes(',')) {
        where.type = { in: upperType.split(',').map((t) => t.trim()) }
      } else {
        where.type = upperType
      }
    }
    if (status && status !== 'all') {
      where.status = String(status).toUpperCase()
    }
    if (modelId && modelId !== 'all') {
      where.modelId = modelId
    }
    if (search && String(search).trim()) {
      const q = String(search).trim()
      where.OR = [
        { id: { contains: q } },
        { prompt: { contains: q } },
        { user: { email: { contains: q } } }
      ]
    }

    const [total, jobs] = await Promise.all([
      prisma.generationJob.count({ where }),
      prisma.generationJob.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, fullName: true }
          },
          assets: {
            select: {
              id: true,
              mediaType: true,
              storagePath: true,
              thumbnailPath: true,
              dimensions: true,
              fileSizeBytes: true,
              createdAt: true
            }
          }
        }
      })
    ])

    const formattedJobs = jobs.map((job) => {
      const assets = (job.assets || []).map((asset) => {
        let width = 1024
        let height = 1024
        if (asset.dimensions && typeof asset.dimensions === 'string') {
          const parts = asset.dimensions.toLowerCase().split('x')
          if (parts.length === 2) {
            width = parseInt(parts[0], 10) || 1024
            height = parseInt(parts[1], 10) || 1024
          }
        }
        return {
          id: asset.id,
          mediaType: asset.mediaType,
          storagePath: asset.storagePath,
          thumbnailPath: asset.thumbnailPath || asset.storagePath,
          dimensions: asset.dimensions || `${width}x${height}`,
          width,
          height,
          fileSizeBytes: asset.fileSizeBytes ? Number(asset.fileSizeBytes) : 0,
          createdAt: asset.createdAt
        }
      })

      return {
        ...job,
        assets
      }
    })

    return {
      jobs: formattedJobs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  static async getQueueMetrics() {
    const [queued, processing, pending, activeWorkers] = await Promise.all([
      prisma.generationJob.count({ where: { status: 'QUEUED' } }),
      prisma.generationJob.count({ where: { status: 'PROCESSING' } }),
      prisma.generationJob.count({ where: { status: 'PENDING' } }),
      prisma.gpuNode.count({ where: { status: { in: ['ONLINE', 'BUSY'] } } })
    ])

    // Query average execution time of recent 20 completed jobs
    const recentCompleted = await prisma.generationJob.findMany({
      where: { status: 'COMPLETED', executionTimeMs: { not: null } },
      take: 20,
      orderBy: { completedAt: 'desc' },
      select: { executionTimeMs: true }
    })

    const avgExecutionMs =
      recentCompleted.length > 0
        ? Math.round(recentCompleted.reduce((acc, j) => acc + (j.executionTimeMs || 0), 0) / recentCompleted.length)
        : 4500

    return {
      queuedJobs: queued,
      processingJobs: processing,
      pendingJobs: pending,
      totalActiveQueue: queued + processing + pending,
      activeWorkers,
      avgExecutionMs,
      estimatedWaitSeconds: Math.ceil(((queued + 1) * (avgExecutionMs / 1000)) / Math.max(1, activeWorkers))
    }
  }

  static async getFailedJobs({ page = 1, limit = 20 } = {}) {
    return await this.listJobs({ page, limit, status: 'FAILED' })
  }

  static async adminCancelJob(actorId, jobId, reason, ipAddress) {
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        user: { include: { wallet: true } }
      }
    })

    if (!job) {
      throw new AppError('Generation job not found', 404, 'JOB_NOT_FOUND')
    }

    if (['COMPLETED', 'CANCELED'].includes(job.status)) {
      throw new AppError(`Cannot cancel job in ${job.status} state`, 400, 'INVALID_STATE')
    }

    const updatedJob = await prisma.$transaction(async (tx) => {
      const canceled = await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELED',
          errorMessage: reason || 'Canceled by platform administrator',
          completedAt: new Date()
        }
      })

      // Refund reserved credits if creditCost > 0
      if (job.creditCost > 0 && job.user.wallet) {
        const wallet = await tx.creditWallet.findUnique({ where: { id: job.user.wallet.id } })
        const newBalance = wallet.balance + job.creditCost

        await tx.creditWallet.update({
          where: { id: wallet.id },
          data: { balance: newBalance }
        })

        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            referenceId: job.id,
            amount: job.creditCost,
            type: 'CREDIT',
            category: 'REFUND',
            description: `Admin cancellation refund for job ${job.id}`
          }
        })
      }

      return canceled
    })

    await AuditService.log({
      actorId,
      action: 'ADMIN_JOB_CANCEL',
      targetEntity: 'JOB',
      targetId: jobId,
      ipAddress,
      diffJson: {
        previousStatus: job.status,
        newStatus: 'CANCELED',
        refundedCredits: job.creditCost,
        reason: reason || 'Administrative cancellation'
      }
    })

    return updatedJob
  }

  static async adminRetryJob(actorId, jobId, ipAddress) {
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId }
    })

    if (!job) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND')
    }

    const updated = await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'QUEUED',
        errorMessage: null,
        completedAt: null,
        executionTimeMs: null,
        workerNodeId: null
      }
    })

    await AuditService.log({
      actorId,
      action: 'ADMIN_JOB_RETRY',
      targetEntity: 'JOB',
      targetId: jobId,
      ipAddress,
      diffJson: {
        previousStatus: job.status,
        newStatus: 'QUEUED'
      }
    })

    return updated
  }

  // ===========================================================================
  // 5. GPU NODE FLEET MANAGEMENT
  // ===========================================================================

  static async listGpuNodes() {
    let nodes = await prisma.gpuNode.findMany({
      orderBy: { createdAt: 'asc' }
    })

    // Seed initial nodes if empty
    if (nodes.length === 0) {
      const initialNodes = [
        {
          id: 'node-a100-primary',
          name: 'Primary Cluster Node A100',
          ipAddress: '10.0.0.101',
          gpuModel: 'NVIDIA A100-SXM4-80GB',
          totalVramGb: 80,
          usedVramGb: 14,
          status: 'ONLINE',
          lastHeartbeatAt: new Date()
        },
        {
          id: 'node-rtx4090-worker-01',
          name: 'Edge Worker Node RTX 4090 #1',
          ipAddress: '10.0.0.102',
          gpuModel: 'NVIDIA GeForce RTX 4090 24GB',
          totalVramGb: 24,
          usedVramGb: 8,
          status: 'ONLINE',
          lastHeartbeatAt: new Date()
        }
      ]

      for (const n of initialNodes) {
        await prisma.gpuNode.create({ data: n })
      }
      nodes = await prisma.gpuNode.findMany({ orderBy: { createdAt: 'asc' } })
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

    return nodes.map((n) => ({
      ...n,
      isOnline: n.status !== 'OFFLINE' && new Date(n.lastHeartbeatAt) >= fiveMinutesAgo,
      status:
        new Date(n.lastHeartbeatAt) < fiveMinutesAgo && n.status !== 'OFFLINE'
          ? 'OFFLINE'
          : n.status
    }))
  }

  static async registerOrHeartbeatGpuNode({ id, name, ipAddress, gpuModel, totalVramGb, usedVramGb, status }) {
    if (!id) {
      throw new AppError('Node ID is required', 400, 'MISSING_NODE_ID')
    }

    const node = await prisma.gpuNode.upsert({
      where: { id },
      update: {
        ...(name && { name }),
        ...(ipAddress && { ipAddress }),
        ...(gpuModel && { gpuModel }),
        ...(totalVramGb !== undefined && { totalVramGb: parseInt(totalVramGb, 10) }),
        ...(usedVramGb !== undefined && { usedVramGb: parseInt(usedVramGb, 10) }),
        ...(status && { status }),
        lastHeartbeatAt: new Date()
      },
      create: {
        id,
        name: name || `Worker Node ${id}`,
        ipAddress: ipAddress || '127.0.0.1',
        gpuModel: gpuModel || 'NVIDIA RTX 4090',
        totalVramGb: totalVramGb ? parseInt(totalVramGb, 10) : 24,
        usedVramGb: usedVramGb ? parseInt(usedVramGb, 10) : 0,
        status: status || 'ONLINE',
        lastHeartbeatAt: new Date()
      }
    })

    return node
  }

  static async updateGpuNode(actorId, nodeId, data, ipAddress) {
    const existing = await prisma.gpuNode.findUnique({ where: { id: nodeId } })
    if (!existing) {
      throw new AppError('GPU Node not found', 404, 'NODE_NOT_FOUND')
    }

    const updatePayload = {}
    if (data.name !== undefined) updatePayload.name = data.name
    if (data.status !== undefined) updatePayload.status = data.status
    if (data.usedVramGb !== undefined) updatePayload.usedVramGb = parseInt(data.usedVramGb, 10)

    const updated = await prisma.gpuNode.update({
      where: { id: nodeId },
      data: updatePayload
    })

    await AuditService.log({
      actorId,
      action: 'GPU_NODE_UPDATE',
      targetEntity: 'GPU_NODE',
      targetId: nodeId,
      ipAddress,
      diffJson: { before: existing, after: updated }
    })

    return updated
  }

  static async deleteGpuNode(actorId, nodeId, ipAddress) {
    const existing = await prisma.gpuNode.findUnique({ where: { id: nodeId } })
    if (!existing) {
      throw new AppError('GPU Node not found', 404, 'NODE_NOT_FOUND')
    }

    await prisma.gpuNode.delete({ where: { id: nodeId } })

    await AuditService.log({
      actorId,
      action: 'GPU_NODE_DELETE',
      targetEntity: 'GPU_NODE',
      targetId: nodeId,
      ipAddress,
      diffJson: { deletedNode: existing }
    })

    return { success: true, id: nodeId }
  }

  // ===========================================================================
  // 6. AI MODEL CATALOG MANAGEMENT
  // ===========================================================================

  static async listModels() {
    let models = await prisma.aiModel.findMany({
      orderBy: { createdAt: 'asc' }
    })

    // Seed default models if table is empty
    if (models.length === 0) {
      const defaultModels = [
        {
          id: 'flux-1-schnell',
          name: 'FLUX.1 Schnell',
          type: 'IMAGE',
          baseCreditCost: 5,
          defaultSteps: 4,
          recommendedCfg: 3.5,
          vramRequiredGb: 12,
          isActive: true
        },
        {
          id: 'flux-1-dev',
          name: 'FLUX.1 Dev',
          type: 'IMAGE',
          baseCreditCost: 10,
          defaultSteps: 28,
          recommendedCfg: 4.5,
          vramRequiredGb: 16,
          isActive: true
        },
        {
          id: 'sd-xl-base',
          name: 'Stable Diffusion XL Base',
          type: 'IMAGE',
          baseCreditCost: 4,
          defaultSteps: 30,
          recommendedCfg: 7.0,
          vramRequiredGb: 10,
          isActive: true
        },
        {
          id: 'wan-2.1-t2v',
          name: 'Wan 2.1 Text-to-Video',
          type: 'VIDEO',
          baseCreditCost: 25,
          defaultSteps: 35,
          recommendedCfg: 6.0,
          vramRequiredGb: 24,
          isActive: true
        },
        {
          id: 'wan-2.1-i2v',
          name: 'Wan 2.1 Image-to-Video',
          type: 'VIDEO',
          baseCreditCost: 30,
          defaultSteps: 40,
          recommendedCfg: 6.0,
          vramRequiredGb: 24,
          isActive: true
        }
      ]

      for (const m of defaultModels) {
        await prisma.aiModel.create({ data: m })
      }

      models = await prisma.aiModel.findMany({ orderBy: { createdAt: 'asc' } })
    }

    return models
  }

  static async updateModel(actorId, modelId, data, ipAddress) {
    const existing = await prisma.aiModel.findUnique({ where: { id: modelId } })
    if (!existing) {
      throw new AppError('AI Model not found', 404, 'MODEL_NOT_FOUND')
    }

    const updatePayload = {}
    if (data.name !== undefined) updatePayload.name = data.name
    if (data.baseCreditCost !== undefined) updatePayload.baseCreditCost = parseInt(data.baseCreditCost, 10)
    if (data.defaultSteps !== undefined) updatePayload.defaultSteps = parseInt(data.defaultSteps, 10)
    if (data.recommendedCfg !== undefined) updatePayload.recommendedCfg = parseFloat(data.recommendedCfg)
    if (data.vramRequiredGb !== undefined) updatePayload.vramRequiredGb = parseInt(data.vramRequiredGb, 10)
    if (data.isActive !== undefined) updatePayload.isActive = Boolean(data.isActive)

    const updated = await prisma.aiModel.update({
      where: { id: modelId },
      data: updatePayload
    })

    await AuditService.log({
      actorId,
      action: 'AI_MODEL_UPDATE',
      targetEntity: 'AI_MODEL',
      targetId: modelId,
      ipAddress,
      diffJson: { before: existing, after: updated }
    })

    return updated
  }

  // ===========================================================================
  // 7. SUBSCRIPTION PLANS & REVENUE
  // ===========================================================================

  static async listPlans() {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { priceMonthly: 'asc' },
      include: {
        _count: {
          select: { subscriptions: true }
        }
      }
    })

    return plans.map((p) => ({
      ...p,
      priceMonthly: Number(p.priceMonthly),
      priceAnnual: Number(p.priceAnnual),
      activeSubscribers: p._count.subscriptions
    }))
  }

  static async updatePlan(actorId, planId, data, ipAddress) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
    if (!existing) {
      throw new AppError('Subscription plan not found', 404, 'PLAN_NOT_FOUND')
    }

    const updatePayload = {}
    if (data.name !== undefined) updatePayload.name = data.name
    if (data.priceMonthly !== undefined) updatePayload.priceMonthly = parseFloat(data.priceMonthly)
    if (data.priceAnnual !== undefined) updatePayload.priceAnnual = parseFloat(data.priceAnnual)
    if (data.monthlyCredits !== undefined) updatePayload.monthlyCredits = parseInt(data.monthlyCredits, 10)
    if (data.maxConcurrentJobs !== undefined) updatePayload.maxConcurrentJobs = parseInt(data.maxConcurrentJobs, 10)
    if (data.isActive !== undefined) updatePayload.isActive = Boolean(data.isActive)
    if (data.featuresJson !== undefined) updatePayload.featuresJson = data.featuresJson

    const updated = await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: updatePayload
    })

    await AuditService.log({
      actorId,
      action: 'SUBSCRIPTION_PLAN_UPDATE',
      targetEntity: 'SUBSCRIPTION_PLAN',
      targetId: planId,
      ipAddress,
      diffJson: { before: existing, after: updated }
    })

    return {
      ...updated,
      priceMonthly: Number(updated.priceMonthly),
      priceAnnual: Number(updated.priceAnnual)
    }
  }

  static async listInvoices({ page = 1, limit = 20, status = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const where = {}
    if (status) where.status = status

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, fullName: true }
          }
        }
      })
    ])

    return {
      invoices: invoices.map((inv) => ({
        ...inv,
        amount: Number(inv.amount)
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  static async getRevenueReport() {
    const [paidAgg, pendingAgg, totalInvoices, activeSubscribers] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID' }
      }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'PENDING' }
      }),
      prisma.invoice.count(),
      prisma.subscription.count({ where: { status: 'ACTIVE' } })
    ])

    const confirmedRevenue = Number(paidAgg._sum.amount || 0)
    const pendingRevenue = Number(pendingAgg._sum.amount || 0)

    // Calculate MRR from active subscriptions
    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true }
    })

    const estimatedMrr = activeSubs.reduce((acc, sub) => {
      const price = Number(sub.plan?.priceMonthly || 0)
      return acc + price
    }, 0)

    return {
      confirmedRevenue,
      pendingRevenue,
      totalInvoices,
      activeSubscribers,
      estimatedMrr
    }
  }

  // ===========================================================================
  // 8. CREDITS SYSTEM OVERVIEW & TRANSACTIONS
  // ===========================================================================

  static async getCreditsOverview({ page = 1, limit = 20, category = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const [circulatingAgg, consumedAgg, grantedAgg] = await Promise.all([
      prisma.creditWallet.aggregate({ _sum: { balance: true } }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'DEBIT', category: { in: ['IMAGE_GENERATION', 'VIDEO_GENERATION'] } }
      }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'CREDIT', category: { in: ['ADMIN_GRANT', 'TOPUP_PACK', 'PLAN_ALLOWANCE'] } }
      })
    ])

    const where = {}
    if (category) where.category = category

    const [totalTx, transactions] = await Promise.all([
      prisma.creditTransaction.count({ where }),
      prisma.creditTransaction.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          wallet: {
            include: {
              user: {
                select: { id: true, email: true, fullName: true }
              }
            }
          }
        }
      })
    ])

    return {
      metrics: {
        totalCirculating: circulatingAgg._sum.balance || 0,
        totalConsumed: consumedAgg._sum.amount || 0,
        totalGranted: grantedAgg._sum.amount || 0
      },
      transactions: transactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        category: tx.category,
        description: tx.description,
        balanceAfter: tx.balanceAfter,
        createdAt: tx.createdAt,
        user: tx.wallet?.user || null
      })),
      pagination: {
        total: totalTx,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalTx / limitNum)
      }
    }
  }

  // ===========================================================================
  // 9. SYSTEM SETTINGS
  // ===========================================================================

  static async getSystemSettings() {
    const settings = await prisma.systemSetting.findMany()
    const settingsMap = {}
    settings.forEach((s) => {
      try {
        settingsMap[s.key] = JSON.parse(s.value)
      } catch {
        settingsMap[s.key] = s.value
      }
    })

    // Defaults for standard platform settings
    const resolvedDefaultCredits =
      settingsMap.defaultFreeCredits !== undefined && settingsMap.defaultFreeCredits !== null
        ? Number(settingsMap.defaultFreeCredits)
        : 50

    return {
      maintenanceMode: settingsMap.maintenanceMode || false,
      allowRegistration: settingsMap.allowRegistration !== false,
      defaultFreeCredits: !isNaN(resolvedDefaultCredits) ? resolvedDefaultCredits : 50,
      maxConcurrentJobsPerUser: settingsMap.maxConcurrentJobsPerUser || 2,
      workerHeartbeatTimeoutSec: settingsMap.workerHeartbeatTimeoutSec || 300,
      systemNotice: settingsMap.systemNotice || '',
      ...settingsMap
    }
  }

  static async updateSystemSettings(actorId, newSettings, ipAddress) {
    if (typeof newSettings !== 'object' || newSettings === null) {
      throw new AppError('Invalid settings object', 400, 'INVALID_SETTINGS')
    }

    if (newSettings.defaultFreeCredits !== undefined) {
      const num = Number(newSettings.defaultFreeCredits)
      if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
        throw new AppError('Starter credits must be a valid non-negative integer', 400, 'INVALID_SETTINGS')
      }
    }

    const previous = await this.getSystemSettings()

    for (const [key, value] of Object.entries(newSettings)) {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: stringValue },
        create: { key, value: stringValue }
      })
    }

    const updated = await this.getSystemSettings()

    await AuditService.log({
      actorId,
      action: 'SYSTEM_SETTINGS_UPDATE',
      targetEntity: 'SYSTEM',
      targetId: 'GLOBAL',
      ipAddress,
      diffJson: { before: previous, after: updated }
    })

    return updated
  }
}
