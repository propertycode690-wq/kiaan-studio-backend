import { prisma } from '../../config/database.js'
import { AssetsService } from '../assets/assets.service.js'
import { ProjectsService } from '../projects/projects.service.js'

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

export class CustomerService {
  /**
   * Aggregated dashboard overview metrics and recent records
   */
  static async getDashboardOverview(userId) {
    const [user, projectsCount, generationsCount, recentAssets, recentProjects] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          wallet: true,
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: true },
            take: 1
          }
        }
      }),
      prisma.project.count({
        where: { userId }
      }),
      prisma.generatedAsset.count({
        where: { userId, deletedAt: null }
      }),
      prisma.generatedAsset.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          job: true,
          project: {
            select: { id: true, name: true, colorTag: true }
          }
        }
      }),
      prisma.project.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        include: {
          _count: {
            select: {
              assets: { where: { deletedAt: null } }
            }
          }
        }
      })
    ])

    if (!user) {
      const error = new Error('User not found')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      throw error
    }

    const activeSubscription = user.subscriptions[0] || null

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        tier: activeSubscription?.plan?.name || (user.role === 'SUPER_ADMIN' ? 'Enterprise Admin' : 'Creator Tier'),
        creditBalance: user.wallet?.balance ?? 0,
        reservedCredits: user.wallet?.reservedBalance ?? 0
      },
      stats: {
        creditBalance: user.wallet?.balance ?? 0,
        totalProjects: projectsCount,
        totalGenerations: generationsCount
      },
      recentGenerations: recentAssets.map(AssetsService.formatAsset),
      recentProjects: recentProjects.map(ProjectsService.formatProject)
    }
  }

  /**
   * List customer download history
   */
  static async getDownloads(userId, { search, type, format, page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const where = {
      userId
    }

    if (format && format !== 'all') {
      where.format = format.toUpperCase()
    }

    if (type && type !== 'all') {
      where.asset = {
        mediaType: type.toUpperCase()
      }
    }

    const [total, records] = await Promise.all([
      prisma.downloadRecord.count({ where }),
      prisma.downloadRecord.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { downloadedAt: 'desc' },
        include: {
          asset: {
            include: { job: true }
          }
        }
      })
    ])

    const formattedRecords = records.map((record) => {
      const asset = record.asset
      const mediaType = asset ? asset.mediaType.toLowerCase() : 'image'
      const name = asset?.job?.prompt
        ? `${asset.job.prompt.slice(0, 24).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${record.format.toLowerCase()}`
        : `kiaan-asset-${record.id.slice(0, 8)}.${record.format.toLowerCase()}`

      return {
        id: record.id,
        name,
        type: mediaType,
        format: record.format.toUpperCase(),
        sizeBytes: asset ? Number(asset.fileSizeBytes || 0) : 0,
        downloadedAt: record.downloadedAt.toISOString(),
        src: asset?.storagePath || '',
        thumb: asset?.thumbnailPath || asset?.storagePath || '',
        source: asset?.job ? formatToolName(asset.job.type) : 'Studio Generation',
        assetId: record.assetId
      }
    })

    const totalBytes = formattedRecords.reduce((acc, r) => acc + r.sizeBytes, 0)

    return {
      downloads: formattedRecords,
      totalBytes,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Log an asset download event
   */
  static async recordDownload(userId, { assetId, format = 'JPG' }) {
    if (!assetId) {
      const error = new Error('Asset ID is required to record download')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const asset = await prisma.generatedAsset.findFirst({
      where: { id: assetId, userId, deletedAt: null }
    })

    if (!asset) {
      const error = new Error('Asset not found or access denied')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    const record = await prisma.downloadRecord.create({
      data: {
        userId,
        assetId,
        format: String(format).toUpperCase()
      },
      include: {
        asset: {
          include: { job: true }
        }
      }
    })

    return {
      id: record.id,
      assetId: record.assetId,
      format: record.format,
      downloadedAt: record.downloadedAt.toISOString(),
      downloadUrl: asset.storagePath
    }
  }

  /**
   * Delete a single download history entry
   */
  static async deleteDownload(userId, downloadId) {
    const existing = await prisma.downloadRecord.findFirst({
      where: { id: downloadId, userId }
    })

    if (!existing) {
      const error = new Error('Download record not found')
      error.statusCode = 404
      error.code = 'RECORD_NOT_FOUND'
      throw error
    }

    await prisma.downloadRecord.delete({
      where: { id: downloadId }
    })

    return { message: 'Download record removed', downloadId }
  }

  /**
   * Clear all download history for a user
   */
  static async clearDownloads(userId) {
    const result = await prisma.downloadRecord.deleteMany({
      where: { userId }
    })

    return {
      message: 'Download history cleared successfully',
      clearedCount: result.count
    }
  }
}

export default CustomerService
