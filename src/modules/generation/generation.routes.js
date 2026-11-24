import { Router } from 'express'
import { GenerationController } from './generation.controller.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireWorkerAuth } from '../../middleware/workerAuth.js'

const router = Router()

// --- AI Worker Interface Routes ---
// Future Python/GPU workers claim, update, complete, or fail jobs
// Strictly guarded against customer tokens
router.use('/worker', requireWorkerAuth)
router.post('/worker/claim', GenerationController.claimJob)
router.post('/worker/heartbeat', GenerationController.workerHeartbeat)
router.post('/worker/jobs/:id/progress', GenerationController.reportProgress)
router.post('/worker/jobs/:id/complete', GenerationController.completeJob)
router.post('/worker/jobs/:id/fail', GenerationController.failJob)

// --- Authenticated Customer Routes ---
router.use(authenticate)

router.get('/jobs', GenerationController.listJobs)
router.post('/jobs', GenerationController.createJob)
router.get('/jobs/:id', GenerationController.getJob)
router.post('/jobs/:id/cancel', GenerationController.cancelJob)
router.post('/jobs/:id/retry', GenerationController.retryJob)

export default router
