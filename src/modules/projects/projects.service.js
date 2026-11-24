import { prisma } from '../../config/database.js'

export class ProjectsService {
  /**
   * Helper to format a project object for API responses
   */
  static formatProject(project) {
    return {
      id: project.id,
      name: project.name,
      description: project.description || '',
      client: project.client || 'Internal',
      color: project.colorTag || 'cyan',
      colorTag: project.colorTag || 'cyan',
      status: 'Active',
      assetsCount: project._count?.assets ?? (project.assets ? project.assets.length : 0),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      assets: (project.assets || []).map((asset) => ({
        id: asset.id,
        mediaType: asset.mediaType,
        type: asset.mediaType.toLowerCase(),
        storagePath: asset.storagePath,
        src: asset.storagePath,
        thumbnailPath: asset.thumbnailPath,
        dimensions: asset.dimensions,
        isFavorite: asset.isFavorite,
        fileSizeBytes: Number(asset.fileSizeBytes || 0),
        createdAt: asset.createdAt.toISOString()
      }))
    }
  }

  /**
   * List projects belonging to the user
   */
  static async listProjects(userId, { search, status, page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const where = {
      userId
    }

    if (search && search.trim()) {
      const q = search.trim()
      where.OR = [
        { name: { contains: q } },
        { description: { contains: q } },
        { client: { contains: q } }
      ]
    }

    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              assets: {
                where: { deletedAt: null }
              }
            }
          },
          assets: {
            where: { deletedAt: null },
            take: 4,
            orderBy: { createdAt: 'desc' }
          }
        }
      })
    ])

    return {
      projects: projects.map(ProjectsService.formatProject),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Get a single project by ID with its assets
   */
  static async getProject(userId, projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        assets: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { job: true }
        }
      }
    })

    if (!project) {
      const error = new Error('Project not found')
      error.statusCode = 404
      error.code = 'PROJECT_NOT_FOUND'
      throw error
    }

    return ProjectsService.formatProject(project)
  }

  /**
   * Create a new project
   */
  static async createProject(userId, { name, client, colorTag, color, description }) {
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      const error = new Error('Project name is required and must be at least 2 characters')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const assignedColor = color || colorTag || 'cyan'

    const project = await prisma.project.create({
      data: {
        userId,
        name: name.trim(),
        client: client ? client.trim() : 'Internal',
        colorTag: assignedColor,
        description: description ? description.trim() : null
      },
      include: {
        assets: true
      }
    })

    return ProjectsService.formatProject(project)
  }

  /**
   * Update an existing project
   */
  static async updateProject(userId, projectId, data) {
    const existing = await prisma.project.findFirst({
      where: { id: projectId, userId }
    })

    if (!existing) {
      const error = new Error('Project not found')
      error.statusCode = 404
      error.code = 'PROJECT_NOT_FOUND'
      throw error
    }

    const updateData = {}
    if (data.name !== undefined) {
      if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
        const error = new Error('Project name must be at least 2 characters')
        error.statusCode = 400
        error.code = 'VALIDATION_ERROR'
        throw error
      }
      updateData.name = data.name.trim()
    }

    if (data.client !== undefined) {
      updateData.client = data.client ? data.client.trim() : 'Internal'
    }

    if (data.color !== undefined || data.colorTag !== undefined) {
      updateData.colorTag = data.color || data.colorTag
    }

    if (data.description !== undefined) {
      updateData.description = data.description ? data.description.trim() : null
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: {
        assets: {
          where: { deletedAt: null }
        }
      }
    })

    return ProjectsService.formatProject(updated)
  }

  /**
   * Delete a project (unlinks assets, deletes project)
   */
  static async deleteProject(userId, projectId) {
    const existing = await prisma.project.findFirst({
      where: { id: projectId, userId }
    })

    if (!existing) {
      const error = new Error('Project not found')
      error.statusCode = 404
      error.code = 'PROJECT_NOT_FOUND'
      throw error
    }

    await prisma.project.delete({
      where: { id: projectId }
    })

    return { message: 'Project deleted successfully', projectId }
  }

  /**
   * Assign an asset to a project
   */
  static async assignAsset(userId, projectId, assetId) {
    const [project, asset] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, userId } }),
      prisma.generatedAsset.findFirst({ where: { id: assetId, userId, deletedAt: null } })
    ])

    if (!project) {
      const error = new Error('Project not found')
      error.statusCode = 404
      error.code = 'PROJECT_NOT_FOUND'
      throw error
    }

    if (!asset) {
      const error = new Error('Asset not found')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    await prisma.generatedAsset.update({
      where: { id: assetId },
      data: { projectId }
    })

    return { message: 'Asset assigned to project', projectId, assetId }
  }

  /**
   * Remove an asset from a project
   */
  static async removeAsset(userId, projectId, assetId) {
    const [project, asset] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, userId } }),
      prisma.generatedAsset.findFirst({ where: { id: assetId, userId, projectId } })
    ])

    if (!project) {
      const error = new Error('Project not found')
      error.statusCode = 404
      error.code = 'PROJECT_NOT_FOUND'
      throw error
    }

    if (!asset) {
      const error = new Error('Asset not found or not in this project')
      error.statusCode = 404
      error.code = 'ASSET_NOT_FOUND'
      throw error
    }

    await prisma.generatedAsset.update({
      where: { id: assetId },
      data: { projectId: null }
    })

    return { message: 'Asset removed from project', projectId, assetId }
  }
}

export default ProjectsService
