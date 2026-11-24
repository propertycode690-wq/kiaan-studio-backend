import { GenerationService } from './generation.service.js'
import { WorkerService } from './worker.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class GenerationController {
  static async createJob(req, res, next) {
    try {
      const { type, modelId, prompt, negativePrompt, parameters, projectId } = req.body
      const job = await GenerationService.createJob(req.user.id, {
        type,
        modelId,
        prompt,
        negativePrompt,
        parameters,
        projectId
      })
      return apiResponse.success(res, job, 201, { message: 'Generation job enqueued successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async cancelJob(req, res, next) {
    try {
      const { id } = req.params
      const result = await GenerationService.cancelJob(req.user.id, id)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async retryJob(req, res, next) {
    try {
      const { id } = req.params
      const newJob = await GenerationService.retryJob(req.user.id, id)
      return apiResponse.success(res, newJob, 201, { message: 'Job retry enqueued' })
    } catch (error) {
      next(error)
    }
  }

  static async listJobs(req, res, next) {
    try {
      const { status, type, page, limit } = req.query
      const result = await GenerationService.listJobs(req.user.id, {
        status,
        type,
        page,
        limit
      })
      return apiResponse.success(res, result.jobs, 200, { pagination: result.pagination })
    } catch (error) {
      next(error)
    }
  }

  static async getJob(req, res, next) {
    try {
      const { id } = req.params
      const job = await GenerationService.getJob(req.user.id, id)
      return apiResponse.success(res, job, 200)
    } catch (error) {
      next(error)
    }
  }

  // --- AI Worker Interface Handlers ---

  static async claimJob(req, res, next) {
    try {
      const { workerNodeId, supportedTypes, supportedModels } = req.body
      const job = await WorkerService.claimNextJob({
        workerNodeId,
        supportedTypes,
        supportedModels
      })
      if (!job) {
        return apiResponse.success(res, null, 200, { message: 'No queued jobs available' })
      }
      return apiResponse.success(res, job, 200, { message: 'Job claimed by worker' })
    } catch (error) {
      next(error)
    }
  }

  static async reportProgress(req, res, next) {
    try {
      const { id } = req.params
      const result = await WorkerService.reportProgress(id, req.body)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async completeJob(req, res, next) {
    try {
      const { id } = req.params
      const result = await WorkerService.completeJob(id, req.body)
      return apiResponse.success(res, result, 200, { message: 'Job completed by worker' })
    } catch (error) {
      next(error)
    }
  }

  static async failJob(req, res, next) {
    try {
      const { id } = req.params
      const result = await WorkerService.failJob(id, req.body)
      return apiResponse.success(res, result, 200, { message: 'Job failure processed and refunded' })
    } catch (error) {
      next(error)
    }
  }

  static async workerHeartbeat(req, res, next) {
    try {
      const { AdminService } = await import('../admin/admin.service.js')
      const result = await AdminService.registerOrHeartbeatGpuNode(req.body)
      return apiResponse.success(res, result, 'Heartbeat recorded')
    } catch (error) {
      next(error)
    }
  }
}

export default GenerationController
