import { WorkerService } from './worker.service.js'
import { GenerationService } from './generation.service.js'
import { CloudflareAiService, CLOUDFLARE_MODELS } from './cloudflareAi.service.js'
import { WavespeedAiService } from './wavespeedAi.service.js'
import { logger } from '../../utils/logger.js'

const SUPPORTED_MODELS = [...Object.keys(CLOUDFLARE_MODELS), 'z-image-turbo', 'flux-depth-canny']
const WORKER_NODE_ID = process.env.WORKER_NODE_ID || 'cloudflare-worker-local-1'

let isDaemonRunning = false
let pollTimeout = null

export class CloudflareWorkerDaemon {
  /**
   * Process a single claimed generation job with Cloudflare Workers AI
   */
  static async processJob(job) {
    if (!job) return null

    const startTime = Date.now()
    logger.info(`[Cloudflare Worker] Processing job #${job.id} (Model: ${job.modelId})...`)

    // Parse parameters
    let params = job.parametersJson || {}
    if (typeof params === 'string') {
      try {
        params = JSON.parse(params)
      } catch {
        params = {}
      }
    }

    try {
      let result

      if (job.type === 'IMAGE_TO_IMAGE') {
        if (job.modelId === 'flux-2-klein-4b') {
          // Step 1: Report progress - Initializing Cloudflare Img2Img
          await WorkerService.reportProgress(job.id, {
            workerNodeId: WORKER_NODE_ID,
            progressPercent: 20,
            currentStep: 1,
            totalSteps: 4,
            statusMessage: 'Connecting to Cloudflare Workers AI (FLUX.2 Klein Img2Img)...'
          })

          // Step 2: Call Cloudflare AI Image-to-Image inference
          result = await CloudflareAiService.generateImageToImage({
            prompt: job.prompt,
            referenceImagePath: params.referenceImage,
            parameters: params,
            jobId: job.id
          })
        } else if (job.modelId === 'z-image-turbo') {
          throw new Error(`[WaveSpeed AI Error] Image-to-Image transformation on '${job.modelId}' is currently under development. Please select FLUX.2 Klein (Flow Match).`)
        } else if (job.modelId === 'flux-depth-canny') {
          throw new Error(`[Cloudflare AI Error] Model '${job.modelId}' is currently under development. Please select FLUX.2 Klein (Flow Match).`)
        } else {
          throw new Error(`[Generation Worker Error] Unsupported model '${job.modelId}' for IMAGE_TO_IMAGE.`)
        }
      } else if (job.modelId === 'z-image-turbo') {
        // Step 1: Report progress - Initializing WaveSpeed
        await WorkerService.reportProgress(job.id, {
          workerNodeId: WORKER_NODE_ID,
          progressPercent: 20,
          currentStep: 1,
          totalSteps: 4,
          statusMessage: 'Connecting to WaveSpeed AI (Z-Image Turbo)...'
        })

        // Step 2: Call WaveSpeed AI inference
        result = await WavespeedAiService.generateImage({
          prompt: job.prompt,
          parameters: params,
          jobId: job.id,
          onProgress: async (percent, message) => {
            await WorkerService.reportProgress(job.id, {
              workerNodeId: WORKER_NODE_ID,
              progressPercent: percent,
              currentStep: 2,
              totalSteps: 4,
              statusMessage: message
            })
          }
        })
      } else {
        // Step 1: Report progress - Initializing Cloudflare
        await WorkerService.reportProgress(job.id, {
          workerNodeId: WORKER_NODE_ID,
          progressPercent: 20,
          currentStep: 1,
          totalSteps: 4,
          statusMessage: `Connecting to Cloudflare Workers AI (${job.modelId})...`
        })

        // Step 2: Call Cloudflare AI inference
        result = await CloudflareAiService.generateImage({
          modelId: job.modelId,
          prompt: job.prompt,
          parameters: params,
          jobId: job.id
        })
      }

      // Step 3: Report progress - Finalizing asset
      await WorkerService.reportProgress(job.id, {
        workerNodeId: WORKER_NODE_ID,
        progressPercent: 90,
        currentStep: 4,
        totalSteps: 4,
        statusMessage: 'Persisting asset to Studio storage...'
      })

      const totalTime = Date.now() - startTime

      // Step 4: Complete job and finalize credit deduction
      const assetRecord = {
        storagePath: result.storagePath,
        thumbnailPath: result.thumbnailPath,
        dimensions: result.dimensions,
        fileSizeBytes: result.fileSizeBytes,
        mediaType: 'IMAGE',
        projectId: params.projectId || null
      }

      const completed = await WorkerService.completeJob(job.id, {
        workerNodeId: WORKER_NODE_ID,
        executionTimeMs: totalTime,
        assets: [assetRecord]
      })

      logger.info(`[Cloudflare Worker] Job #${job.id} completed successfully in ${totalTime}ms`)
      return completed
    } catch (err) {
      const totalTime = Date.now() - startTime
      logger.error(`[Cloudflare Worker] Job #${job.id} failed: ${err.message}`)

      // Map flagged safety errors to clean user-facing guidance
      let userErrorMessage = err.message
      if (err.isFlagged || err.code === 'CONTENT_OUTPUT_FLAGGED' || /flagged|content moderation|safety/i.test(err.message)) {
        userErrorMessage = 'The AI safety filter flagged the generated output for this prompt. Please try a different description or prompt variation. Your reserved credits have been fully refunded.'
      }

      // Fail job and trigger automatic credit refund exactly once
      try {
        await WorkerService.failJob(job.id, {
          workerNodeId: WORKER_NODE_ID,
          errorMessage: userErrorMessage,
          executionTimeMs: totalTime
        })
        logger.info(`[Cloudflare Worker] Job #${job.id} marked FAILED, credits refunded.`)
      } catch (refundErr) {
        logger.error(`[Cloudflare Worker] Error while recording job failure: ${refundErr.message}`)
      }

      throw err
    }
  }

  /**
   * Poll for the next queued Cloudflare job and process it
   */
  static async pollAndProcessNextJob() {
    try {
      // Periodically sweep orphaned jobs that exceeded safe timeouts
      await GenerationService.cleanupStuckJobs()

      const job = await WorkerService.claimNextJob({
        workerNodeId: WORKER_NODE_ID,
        supportedTypes: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'],
        supportedModels: SUPPORTED_MODELS
      })

      if (!job) {
        return null
      }

      return await this.processJob(job)
    } catch (err) {
      logger.error(`[Cloudflare Worker] Error in polling cycle: ${err.message}`)
      return null
    }
  }

  /**
   * Start the continuous background polling loop
   */
  static startWorkerDaemon({ intervalMs = 2000 } = {}) {
    if (isDaemonRunning) {
      logger.warn('[Cloudflare Worker] Daemon already active.')
      return
    }

    const hasCloudflare = CloudflareAiService.isConfigured() || CloudflareAiService.isImg2ImgConfigured()
    const hasWavespeed = WavespeedAiService.isConfigured()

    if (!hasCloudflare && !hasWavespeed) {
      logger.warn('[Cloudflare Worker] Neither Cloudflare nor WaveSpeed credentials are set. Daemon will not poll live API.')
      return
    }

    isDaemonRunning = true
    logger.info(`[Cloudflare Worker] Background daemon started (polling every ${intervalMs}ms, models: ${SUPPORTED_MODELS.join(', ')})`)

    const poll = async () => {
      if (!isDaemonRunning) return

      try {
        await this.pollAndProcessNextJob()
      } catch (e) {
        logger.error(`[Cloudflare Worker] Uncaught cycle error: ${e.message}`)
      } finally {
        if (isDaemonRunning) {
          pollTimeout = setTimeout(poll, intervalMs)
        }
      }
    }

    poll()
  }

  /**
   * Stop the continuous background polling loop
   */
  static stopWorkerDaemon() {
    isDaemonRunning = false
    if (pollTimeout) {
      clearTimeout(pollTimeout)
      pollTimeout = null
    }
    logger.info('[Cloudflare Worker] Background daemon stopped.')
  }
}

export default CloudflareWorkerDaemon

// Auto-start if run directly via Node CLI
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/modules/generation/cloudflareWorker.js')) {
  logger.info('Starting standalone Cloudflare Worker Daemon...')
  CloudflareWorkerDaemon.startWorkerDaemon({ intervalMs: 2000 })
}
