import { Router } from 'express'
import { AssetsController } from './assets.controller.js'
import { authenticate } from '../../middleware/authenticate.js'

const router = Router()

// All asset routes require authentication
router.use(authenticate)

router.get('/', AssetsController.listAssets)
router.get('/generations', AssetsController.listAssets) // Convenient alias for customer generations view
router.post('/bulk-delete', AssetsController.bulkDelete)

router.get('/:id', AssetsController.getAsset)
router.get('/:id/download', AssetsController.downloadAsset)
router.patch('/:id', AssetsController.updateAsset)
router.put('/:id', AssetsController.updateAsset)
router.delete('/:id', AssetsController.deleteAsset)

router.patch('/:id/favorite', AssetsController.toggleFavorite)
router.post('/:id/favorite', AssetsController.toggleFavorite)

export default router
