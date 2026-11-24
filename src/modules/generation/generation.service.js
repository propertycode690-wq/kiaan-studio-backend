import { prisma } from '../../config/database.js'
import { CreditsService } from '../credits/credits.service.js'
import { AssetsService } from '../assets/assets.service.js'
import { WorkerService } from './worker.service.js'
import { processAndSaveReferenceImage } from '../../utils/imageValidator.js'

const VALID_TYPES = [
  'TEXT_TO_IMAGE',
  'TEXT_TO_VIDEO',
  'IMAGE_TO_IMAGE',
  'IMAGE_EDITOR',
  'IMAGE_TO_VIDEO'
]

export class GenerationService {
  /**
   * Format a generation job for API responses
   */
  static formatJob(job, queuePosition = null) {
    let params = {}
    if (job.parametersJson) {
      if (typeof job.parametersJson === 'string') {
        try {
          params = JSON.parse(job.parametersJson)
        } catch {
          params = {}
        }
      } else {
        params = job.parametersJson
      }
    }

    return {
      id: job.id,
      userId: job.userId,
      type: job.type,
      status: job.status,
      modelId: job.modelId,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      parameters: params,
      creditCost: job.creditCost,
      executionTimeMs: job.executionTimeMs,
      errorMessage: job.errorMessage,
      workerNodeId: job.workerNodeId,
      queuePosition: queuePosition !== null ? queuePosition : undefined,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      assets: (job.assets || []).map(AssetsService.formatAsset)
    }
  }

  /**
   * Safely sweep orphaned/stuck jobs that exceeded normal execution timeouts.
   * Performs idempotent status updates and refunds reserved credits.
   * Never expires actively running valid jobs within their operational window.
   */
  static async cleanupStuckJobs(targetUserId = null) {
    try {
      const now = Date.now()
      const imageCutoff = new Date(now - 5 * 60 * 1000) // 5 minutes for image jobs
      const videoCutoff = new Date(now - 15 * 60 * 1000) // 15 minutes for video jobs

      const whereClause = {
        status: { in: ['QUEUED', 'PROCESSING'] },
        OR: [
          {
            type: { in: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'IMAGE_EDITOR'] },
            createdAt: { lte: imageCutoff }
          },
          {
            type: { in: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] },
            createdAt: { lte: videoCutoff }
          }
        ]
      }

      if (targetUserId) {
        whereClause.userId = targetUserId
      }

      const stuckJobs = await prisma.generationJob.findMany({
        where: whereClause,
        take: 50
      })

      for (const stuckJob of stuckJobs) {
        const ageSec = Math.round((now - new Date(stuckJob.createdAt).getTime()) / 1000)
        try {
          await WorkerService.failJob(stuckJob.id, {
            workerNodeId: 'system-queue-watchdog',
            errorMessage: `Job timed out after ${ageSec}s without completion. Your reserved credits have been fully restored.`,
            executionTimeMs: ageSec * 1000
          })
        } catch {
          // WorkerService.failJob is idempotent; ignore alreadyResolved
        }
      }
    } catch {
      // Non-blocking cleanup failure
    }
  }

  /**
   * Submit and enqueue a new generation job with atomic credit reservation
   */
  static async createJob(userId, { type, modelId, prompt, negativePrompt, parameters = {}, projectId = null }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      const error = new Error('Prompt is required')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (prompt.trim().length > 2000) {
      const error = new Error('Prompt cannot exceed 2000 characters')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const normalizedType = type ? String(type).toUpperCase() : 'TEXT_TO_IMAGE'
    if (!VALID_TYPES.includes(normalizedType)) {
      const error = new Error(`Invalid generation type. Must be one of: ${VALID_TYPES.join(', ')}`)
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    // For IMAGE_TO_IMAGE, validate and persist reference image
    if (normalizedType === 'IMAGE_TO_IMAGE') {
      const rawImage = parameters.referenceImage || parameters.inputImage || parameters.sourceImage
      if (!rawImage) {
        const error = new Error('Reference image is required for Image-to-Image generation.')
        error.statusCode = 400
        error.code = 'VALIDATION_ERROR'
        throw error
      }
      const savedRef = processAndSaveReferenceImage(rawImage, userId)
      parameters.referenceImage = savedRef.storagePath
      parameters.referenceDimensions = `${savedRef.width}x${savedRef.height}`
      parameters.referenceMimeType = savedRef.mimeType
    }

    const assignedModel = modelId || (normalizedType.includes('VIDEO') ? 'wan-2.1-video-720p' : 'flux-2-klein-4b')
    const creditCost = CreditsService.calculateCost(normalizedType, assignedModel, parameters)

    // Check credit balance before queueing
    const wallet = await prisma.creditWallet.findUnique({
      where: { userId }
    })
    if (!wallet || wallet.balance < creditCost) {
      const error = new Error(`Insufficient credits. Required: ${creditCost}, Available: ${wallet ? wallet.balance : 0}`)
      error.statusCode = 402
      error.code = 'INSUFFICIENT_CREDITS'
      error.details = { required: creditCost, available: wallet ? wallet.balance : 0 }
      throw error
    }

    // Fail-closed server-side worker readiness guard:
    // Prevents chargeable generation submissions and credit reservations while GPU inference worker is offline.
    const isWorkerReady = process.env.ENABLE_AI_WORKER === 'true'
    if (!isWorkerReady) {
      const error = new Error('AI inference service is currently offline. New generation submissions are temporarily suspended to protect your credits.')
      error.statusCode = 503
      error.code = 'WORKER_UNAVAILABLE'
      throw error
    }

    // Automatically sweep orphaned/stuck jobs for this user before evaluating concurrency
    await GenerationService.cleanupStuckJobs(userId)

    // Check concurrency limit against active subscription
    const sub = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' }
    })
    const maxConcurrent = sub?.plan?.maxConcurrentJobs ?? 1

    const activeJobsCount = await prisma.generationJob.count({
      where: {
        userId,
        status: { in: ['QUEUED', 'PROCESSING'] }
      }
    })

    if (activeJobsCount >= maxConcurrent) {
      const error = new Error(`Concurrent job limit (${maxConcurrent}) reached for your plan. Please wait for active jobs to complete.`)
      error.statusCode = 429
      error.code = 'CONCURRENT_LIMIT_REACHED'
      throw error
    }

    const category = normalizedType.includes('VIDEO') ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION'

    // Atomic transaction: reserve credits and create queued job
    const newJob = await prisma.$transaction(async (tx) => {
      // 1. Reserve credits
      await CreditsService.reserveCredits(
        userId,
        creditCost,
        category,
        `${normalizedType} render on ${assignedModel}`,
        null,
        tx
      )

      // 2. Create job in QUEUED status
      const job = await tx.generationJob.create({
        data: {
          userId,
          type: normalizedType,
          status: 'QUEUED',
          modelId: assignedModel,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt ? String(negativePrompt).trim() : null,
          parametersJson: parameters,
          creditCost
        }
      })

      return job
    })

    // Calculate queue position
    const queuePosition = await prisma.generationJob.count({
      where: {
        status: 'QUEUED',
        createdAt: { lte: newJob.createdAt }
      }
    })

    return GenerationService.formatJob(newJob, queuePosition)
  }

  /**
   * Cancel an enqueued job and automatically refund reserved credits
   */
  static async cancelJob(userId, jobId) {
    const job = await prisma.generationJob.findFirst({
      where: { id: jobId, userId }
    })

    if (!job) {
      const error = new Error('Generation job not found')
      error.statusCode = 404
      error.code = 'JOB_NOT_FOUND'
      throw error
    }

    if (job.status === 'PROCESSING') {
      const error = new Error('Job is actively running on a GPU worker node and cannot be canceled')
      error.statusCode = 400
      error.code = 'JOB_PROCESSING'
      throw error
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELED') {
      const error = new Error(`Cannot cancel job with status: ${job.status}`)
      error.statusCode = 400
      error.code = 'INVALID_JOB_STATE'
      throw error
    }

    // Cancel in transaction and refund
    await prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELED',
          completedAt: new Date()
        }
      })

      const category = job.type.includes('VIDEO') ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION'
      await CreditsService.refundCredits(
        userId,
        job.creditCost,
        category,
        `Refund for canceled job ${job.id}`,
        job.id,
        tx
      )
    })

    return {
      message: 'Job canceled successfully',
      jobId,
      refundedCredits: job.creditCost
    }
  }

  /**
   * Retry a failed or canceled job
   */
  static async retryJob(userId, jobId) {
    const previousJob = await prisma.generationJob.findFirst({
      where: { id: jobId, userId }
    })

    if (!previousJob) {
      const error = new Error('Generation job not found')
      error.statusCode = 404
      error.code = 'JOB_NOT_FOUND'
      throw error
    }

    if (previousJob.status !== 'FAILED' && previousJob.status !== 'CANCELED') {
      const error = new Error(`Only failed or canceled jobs can be retried. Current status: ${previousJob.status}`)
      error.statusCode = 400
      error.code = 'INVALID_JOB_STATE'
      throw error
    }

    return this.createJob(userId, {
      type: previousJob.type,
      modelId: previousJob.modelId,
      prompt: previousJob.prompt,
      negativePrompt: previousJob.negativePrompt,
      parameters: previousJob.parametersJson
    })
  }

  /**
   * List jobs for user
   */
  static async listJobs(userId, { status, type, page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const where = {
      userId
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase()
    }

    if (type && type !== 'all') {
      where.type = type.toUpperCase()
    }

    const [total, jobs] = await Promise.all([
      prisma.generationJob.count({ where }),
      prisma.generationJob.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          assets: {
            where: { deletedAt: null }
          }
        }
      })
    ])

    return {
      jobs: jobs.map((j) => GenerationService.formatJob(j)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Get single job by ID
   */
  static async getJob(userId, jobId) {
    const job = await prisma.generationJob.findFirst({
      where: { id: jobId, userId },
      include: {
        assets: {
          where: { deletedAt: null }
        }
      }
    })

    if (!job) {
      const error = new Error('Generation job not found')
      error.statusCode = 404
      error.code = 'JOB_NOT_FOUND'
      throw error
    }

    let queuePosition = null
    if (job.status === 'QUEUED') {
      queuePosition = await prisma.generationJob.count({
        where: {
          status: 'QUEUED',
          createdAt: { lte: job.createdAt }
        }
      })
    }

    return GenerationService.formatJob(job, queuePosition)
  }
}

export default GenerationService
