import { prisma } from '../../config/database.js'
import { CreditsService } from '../credits/credits.service.js'
import { AssetsService } from '../assets/assets.service.js'

export class WorkerService {
  /**
   * Worker daemon polls and claims the next queued generation job
   */
  static async claimNextJob({ workerNodeId = 'worker-node-default', supportedTypes, supportedModels } = {}) {
    const where = {
      status: 'QUEUED'
    }

    if (supportedTypes && supportedTypes.length > 0) {
      where.type = { in: supportedTypes }
    }

    if (supportedModels && supportedModels.length > 0) {
      where.modelId = { in: supportedModels }
    }

    // Run in a transaction to prevent race conditions among multiple workers
    const claimedJob = await prisma.$transaction(async (tx) => {
      const nextJob = await tx.generationJob.findFirst({
        where,
        orderBy: { createdAt: 'asc' }
      })

      if (!nextJob) return null

      const updated = await tx.generationJob.update({
        where: { id: nextJob.id },
        data: {
          status: 'PROCESSING',
          workerNodeId
        }
      })

      return updated
    })

    return claimedJob
  }

  /**
   * Worker reports intermediate progress (0 - 100%)
   */
  static async reportProgress(jobId, { workerNodeId, progressPercent, currentStep, totalSteps, statusMessage }) {
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId }
    })

    if (!job) {
      const error = new Error('Job not found')
      error.statusCode = 404
      error.code = 'JOB_NOT_FOUND'
      throw error
    }

    return {
      jobId,
      status: job.status,
      progressPercent: Math.min(100, Math.max(0, parseInt(progressPercent, 10) || 0)),
      currentStep: currentStep || 0,
      totalSteps: totalSteps || 0,
      statusMessage: statusMessage || 'Inferencing latents on GPU node',
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * Worker completes job: creates asset output, finalizes credit deduction
   */
  static async completeJob(jobId, { workerNodeId, executionTimeMs, assets = [] }) {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        const error = new Error('Job not found')
        error.statusCode = 404
        error.code = 'JOB_NOT_FOUND'
        throw error
      }

      if (job.status === 'COMPLETED') {
        return { job, alreadyCompleted: true }
      }

      // Update job record
      const updatedJob = await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          executionTimeMs: executionTimeMs || 1000,
          workerNodeId: workerNodeId || job.workerNodeId
        }
      })

      // Finalize credits deduction
      await CreditsService.finalizeDeduction(job.userId, job.creditCost, tx)

      // Create generated assets
      const createdAssets = []
      for (const assetData of assets) {
        const mediaType = assetData.mediaType || (job.type.includes('VIDEO') ? 'VIDEO' : 'IMAGE')
        const created = await tx.generatedAsset.create({
          data: {
            userId: job.userId,
            jobId: job.id,
            projectId: assetData.projectId || null,
            mediaType,
            storagePath: assetData.storagePath || '/images/landing/gallery-architecture.jpg',
            thumbnailPath: assetData.thumbnailPath || assetData.storagePath || null,
            dimensions: assetData.dimensions || '1024x1024',
            fileSizeBytes: BigInt(assetData.fileSizeBytes || 102400),
            isFavorite: false
          }
        })
        createdAssets.push(created)
      }

      return {
        job: updatedJob,
        assets: createdAssets.map(AssetsService.formatAsset)
      }
    })

    return result
  }

  /**
   * Worker reports failure: marks job FAILED and automatically refunds credits
   */
  static async failJob(jobId, { workerNodeId, errorMessage, executionTimeMs }) {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        const error = new Error('Job not found')
        error.statusCode = 404
        error.code = 'JOB_NOT_FOUND'
        throw error
      }

      if (job.status === 'FAILED' || job.status === 'CANCELED') {
        return { job, alreadyResolved: true }
      }

      // Update status to FAILED
      const updatedJob = await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage: errorMessage || 'GPU inference worker error',
          executionTimeMs: executionTimeMs || 0,
          completedAt: new Date()
        }
      })

      // Automatically refund reserved credits
      const category = job.type.includes('VIDEO') ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION'
      await CreditsService.refundCredits(
        job.userId,
        job.creditCost,
        category,
        `Refund for failed job: ${errorMessage || 'Inference failure'}`,
        job.id,
        tx
      )

      return {
        job: updatedJob,
        refundedCredits: job.creditCost
      }
    })

    return result
  }
}

export default WorkerService
