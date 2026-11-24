import { AssetsService } from './assets.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class AssetsController {
  static async listAssets(req, res, next) {
    try {
      const { search, type, generationType, jobType, favorite, isFavorite, projectId, sort, page, limit } = req.query
      const result = await AssetsService.listAssets(req.user.id, {
        search,
        type,
        generationType,
        jobType,
        favorite,
        isFavorite,
        projectId,
        sort,
        page,
        limit
      })
      return apiResponse.success(res, result.assets, 200, { pagination: result.pagination })
    } catch (error) {
      next(error)
    }
  }

  static async getAsset(req, res, next) {
    try {
      const { id } = req.params
      const asset = await AssetsService.getAsset(req.user.id, id)
      return apiResponse.success(res, asset, 200)
    } catch (error) {
      next(error)
    }
  }

  static async toggleFavorite(req, res, next) {
    try {
      const { id } = req.params
      const asset = await AssetsService.toggleFavorite(req.user.id, id)
      return apiResponse.success(res, asset, 200)
    } catch (error) {
      next(error)
    }
  }

  static async updateAsset(req, res, next) {
    try {
      const { id } = req.params
      const updated = await AssetsService.updateAsset(req.user.id, id, req.body)
      return apiResponse.success(res, updated, 200)
    } catch (error) {
      next(error)
    }
  }

  static async deleteAsset(req, res, next) {
    try {
      const { id } = req.params
      const result = await AssetsService.deleteAsset(req.user.id, id)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async bulkDelete(req, res, next) {
    try {
      const { assetIds } = req.body
      const result = await AssetsService.bulkDelete(req.user.id, assetIds)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async downloadAsset(req, res, next) {
    try {
      const { id } = req.params
      const downloadInfo = await AssetsService.getAssetFileForDownload(
        req.user.id,
        id
      )

      const { asset, filePath, filename, format, isRemote, downloadUrl } = downloadInfo

      // If remote Cloudinary asset, record download and redirect directly to CDN URL
      if (isRemote && downloadUrl) {
        try {
          const { prisma } = await import('../../config/database.js')
          await prisma.downloadRecord.create({
            data: {
              userId: req.user.id,
              assetId: asset.id,
              format: format || 'WEBP'
            }
          })
        } catch {
          // Silently continue
        }

        return res.redirect(downloadUrl)
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

      // Stream file to client and record download ONLY upon successful transmission
      res.sendFile(filePath, async (err) => {
        if (!err) {
          try {
            await import('../../config/database.js').then(async ({ prisma }) => {
              await prisma.downloadRecord.create({
                data: {
                  userId: req.user.id,
                  assetId: asset.id,
                  format
                }
              })
            })
          } catch {
            // Silently continue
          }
        }
      })
    } catch (error) {
      next(error)
    }
  }
}

export default AssetsController
