import fs from 'fs'
import path from 'path'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'

function formatToolName(type) {
  switch (type) {
    case 'TEXT_TO_IMAGE':
      return 'Text-to-Image'
    case 'TEXT_TO_VIDEO':
      return 'Text-to-Video'
    case 'IMAGE_TO_IMAGE':
      return 'Image-to-Image'
    case 'IMAGE_EDITOR':
      return 'Image Editor'
    case 'IMAGE_TO_VIDEO':
      return 'Image-to-Video'
    default:
      return 'Studio Generation'
  }
}

export class AssetsService {
  /**
   * Helper to format a GeneratedAsset row to frontend-compatible schema
   */
  static formatAsset(asset) {
    const job = asset.job || {}
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

    const title = job.prompt
      ? job.prompt.length > 40
        ? `${job.prompt.substring(0, 40).trim()}…`
        : job.prompt
      : asset.mediaType === 'VIDEO'
        ? 'Generated Video'
        : 'Generated Image'

    return {
      id: asset.id,
      jobId: asset.jobId,
      projectId: asset.projectId,
      type: asset.mediaType.toLowerCase(), // 'image' | 'video'
      mediaType: asset.mediaType,
      tool: formatToolName(job.type),
      generationType: job.type || null,
      jobType: job.type || null,
      title,
      prompt: job.prompt || '',
      negativePrompt: job.negativePrompt || '',
      model: job.modelId || 'FLUX.2 Klein 4B',
      dimensions: asset.dimensions || '1024x1024',
      aspect: params.aspect || params.aspectRatio || '1:1',
      seed: params.seed ? String(params.seed) : '482910385',
      steps: params.steps || 4,
      cfg: params.cfg || 3.5,
      credits: job.creditCost ?? 1,
      createdAt: asset.createdAt.toISOString(),
      src: asset.storagePath,
      storagePath: asset.storagePath,
      referenceImage: params.referenceImage || null,
      poster: asset.thumbnailPath || null,
      thumbnailPath: asset.thumbnailPath || null,
      sizeBytes: Number(asset.fileSizeBytes || 0),
      favorite: asset.isFavorite,
      isFavorite: asset.isFavorite
    }
  }

  /**
   * List assets belonging to the user with search, filtering, and sorting
   */
  static async listAssets(userId, { search, type, generationType, jobType, favorite, isFavorite, projectId, sort = 'newest', page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const where = {
      userId,
      deletedAt: null
    }

    // Filter by type
    if (type && type !== 'all') {
      const upper = type.toUpperCase()
      if (upper === 'IMAGE' || upper === 'VIDEO') {
        where.mediaType = upper
      }
    }

    // Filter by favorite
    const favFilter = favorite !== undefined ? favorite : isFavorite
    if (favFilter !== undefined && favFilter !== 'all') {
      where.isFavorite = favFilter === true || favFilter === 'true'
    }

    // Filter by project
    if (projectId && projectId !== 'all') {
      where.projectId = projectId
    }

    // Filter by search query (prompt or model)
    if (search && search.trim()) {
      const q = search.trim()
      where.job = {
        OR: [
          { prompt: { contains: q } },
          { modelId: { contains: q } }
        ]
      }
    }

    // Filter by generation workflow type (e.g. TEXT_TO_IMAGE, TEXT_TO_VIDEO, IMAGE_TO_IMAGE, IMAGE_TO_VIDEO)
    const genType = (generationType || jobType || '').toUpperCase().replace(/-/g, '_')
    if (genType && genType !== 'ALL') {
      if (!where.job) {
        where.job = { type: genType }
      } else {
        where.job.type = genType
      }
    }

    // Determine sorting
    let orderBy = { createdAt: 'desc' }
    if (sort === 'oldest') {
      orderBy = { createdAt: 'asc' }
    }

    const [total, assets] = await Promise.all([
      prisma.generatedAsset.count({ where }),
      prisma.generatedAsset.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          job: true,
          project: {
            select: { id: true, name: true, colorTag: true }
          }
        }
      })
    ])

    return {
      assets: assets.map(AssetsService.formatAsset),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Get single asset by ID
   */
  static async getAsset(userId, assetId) {
    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null },
      include: {
        job: true,
        project: true
      }
    })

    if (!asset) {
      const error = new Error('Asset not found')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    return AssetsService.formatAsset(asset)
  }

  /**
   * Toggle favorite flag for an asset
   */
  static async toggleFavorite(userId, assetId) {
    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null }
    })

    if (!asset) {
      const error = new Error('Asset not found')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    const updated = await prisma.generatedAsset.update({
      where: { id: assetId },
      data: { isFavorite: !asset.isFavorite },
      include: { job: true }
    })

    return AssetsService.formatAsset(updated)
  }

  /**
   * Update asset metadata (e.g. project assignment or favorite)
   */
  static async updateAsset(userId, assetId, data) {
    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null }
    })

    if (!asset) {
      const error = new Error('Asset not found')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    const updateData = {}
    if (data.projectId !== undefined) {
      if (data.projectId) {
        // Verify project ownership
        const project = await prisma.project.findFirst({
          where: { id: data.projectId, userId }
        })
        if (!project) {
          const error = new Error('Project not found')
          error.statusCode = 404
          error.code = 'PROJECT_NOT_FOUND'
          throw error
        }
        updateData.projectId = data.projectId
      } else {
        updateData.projectId = null
      }
    }

    if (data.isFavorite !== undefined || data.favorite !== undefined) {
      updateData.isFavorite = Boolean(data.isFavorite ?? data.favorite)
    }

    const updated = await prisma.generatedAsset.update({
      where: { id: assetId },
      data: updateData,
      include: { job: true }
    })

    return AssetsService.formatAsset(updated)
  }

  /**
   * Soft-delete an asset
   */
  static async deleteAsset(userId, assetId) {
    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null }
    })

    if (!asset) {
      const error = new Error('Asset not found')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    await prisma.generatedAsset.update({
      where: { id: assetId },
      data: { deletedAt: new Date() }
    })

    return { message: 'Asset deleted successfully', assetId }
  }

  /**
   * Bulk soft-delete assets
   */
  static async bulkDelete(userId, assetIds) {
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      const error = new Error('An array of assetIds is required')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const result = await prisma.generatedAsset.updateMany({
      where: {
        id: { in: assetIds },
        userId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    })

    return {
      message: `${result.count} assets deleted successfully`,
      deletedCount: result.count
    }
  }

  /**
   * Securely retrieve owned asset file for download
   * Verifies user ownership, validates file existence on disk, prevents path traversal,
   * and prepares download parameters.
   */
  static async getAssetFileForDownload(userId, assetId) {
    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null },
      include: { job: true }
    })

    if (!asset) {
      const error = new Error('Asset not found or access denied')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    const cleanPrompt = (asset.job?.prompt || 'asset')
      .slice(0, 32)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    // If asset is hosted remotely on Cloudinary or external CDN
    if (asset.storagePath.startsWith('http://') || asset.storagePath.startsWith('https://')) {
      let ext = asset.mediaType === 'VIDEO' ? '.mp4' : '.webp'
      try {
        const parsedUrl = new URL(asset.storagePath)
        const urlExt = path.extname(parsedUrl.pathname)
        if (urlExt) ext = urlExt
      } catch { }

      const downloadFilename = `${cleanPrompt || 'kiaan-studio-asset'}${ext}`

      return {
        asset,
        isRemote: true,
        downloadUrl: asset.storagePath,
        filePath: null,
        filename: downloadFilename,
        format: (ext.replace('.', '') || (asset.mediaType === 'VIDEO' ? 'MP4' : 'WEBP')).toUpperCase()
      }
    }

    // Resolve file path safely and prevent directory traversal
    const rel = asset.storagePath.replace(/^\/?uploads\/?/, '')
    const candidatePaths = [
      path.resolve(env.UPLOADS_DIR, rel),
      path.resolve(process.cwd(), asset.storagePath.replace(/^\//, '')),
      path.resolve(process.cwd(), '../Kiaan-ai-image-generator-frontend/public', asset.storagePath.replace(/^\//, '')),
      path.resolve(process.cwd(), 'uploads', rel)
    ]

    let resolvedPath = null
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedPath = candidate
        break
      }
    }

    if (!resolvedPath) {
      const error = new Error('Requested asset file is not available on disk')
      error.statusCode = 404
      error.code = 'FILE_NOT_FOUND'
      throw error
    }

    const ext = path.extname(resolvedPath) || (asset.mediaType === 'VIDEO' ? '.mp4' : '.jpg')
    const downloadFilename = `${cleanPrompt || 'kiaan-studio-asset'}${ext}`

    return {
      asset,
      filePath: resolvedPath,
      filename: downloadFilename,
      format: (ext.replace('.', '') || (asset.mediaType === 'VIDEO' ? 'MP4' : 'JPG')).toUpperCase()
    }
  }
}

export default AssetsService
