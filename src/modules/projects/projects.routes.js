import { Router } from 'express'
import { ProjectsController } from './projects.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All project routes require authentication
router.use(authenticate)

router.get('/', ProjectsController.listProjects)
router.post('/', ProjectsController.createProject)
router.get('/:id', ProjectsController.getProject)
router.patch('/:id', ProjectsController.updateProject)
router.put('/:id', ProjectsController.updateProject)
router.delete('/:id', ProjectsController.deleteProject)

router.post('/:id/assets/:assetId', ProjectsController.assignAsset)
router.delete('/:id/assets/:assetId', ProjectsController.removeAsset)

export default router
