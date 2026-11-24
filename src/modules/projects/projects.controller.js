import { ProjectsService } from './projects.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class ProjectsController {
  static async listProjects(req, res, next) {
    try {
      const { search, status, page, limit } = req.query
      const result = await ProjectsService.listProjects(req.user.id, {
        search,
        status,
        page,
        limit
      })
      return apiResponse.success(res, result.projects, 200, { pagination: result.pagination })
    } catch (error) {
      next(error)
    }
  }

  static async getProject(req, res, next) {
    try {
      const { id } = req.params
      const project = await ProjectsService.getProject(req.user.id, id)
      return apiResponse.success(res, project, 200)
    } catch (error) {
      next(error)
    }
  }

  static async createProject(req, res, next) {
    try {
      const { name, client, colorTag, color, description } = req.body
      const project = await ProjectsService.createProject(req.user.id, {
        name,
        client,
        colorTag,
        color,
        description
      })
      return apiResponse.success(res, project, 201, { message: 'Project created successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async updateProject(req, res, next) {
    try {
      const { id } = req.params
      const updated = await ProjectsService.updateProject(req.user.id, id, req.body)
      return apiResponse.success(res, updated, 200, { message: 'Project updated successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async deleteProject(req, res, next) {
    try {
      const { id } = req.params
      const result = await ProjectsService.deleteProject(req.user.id, id)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async assignAsset(req, res, next) {
    try {
      const { id, assetId } = req.params
      const result = await ProjectsService.assignAsset(req.user.id, id, assetId)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async removeAsset(req, res, next) {
    try {
      const { id, assetId } = req.params
      const result = await ProjectsService.removeAsset(req.user.id, id, assetId)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default ProjectsController
