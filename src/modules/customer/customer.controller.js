import { CustomerService } from './customer.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class CustomerController {
  static async getOverview(req, res, next) {
    try {
      const data = await CustomerService.getDashboardOverview(req.user.id)
      return apiResponse.success(res, data, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getDownloads(req, res, next) {
    try {
      const { search, type, format, page, limit } = req.query
      const result = await CustomerService.getDownloads(req.user.id, {
        search,
        type,
        format,
        page,
        limit
      })
      return apiResponse.success(res, result.downloads, 200, {
        totalBytes: result.totalBytes,
        pagination: result.pagination
      })
    } catch (error) {
      next(error)
    }
  }

  static async recordDownload(req, res, next) {
    try {
      const { assetId, format } = req.body
      const record = await CustomerService.recordDownload(req.user.id, { assetId, format })
      return apiResponse.success(res, record, 201, { message: 'Download recorded' })
    } catch (error) {
      next(error)
    }
  }

  static async deleteDownload(req, res, next) {
    try {
      const { id } = req.params
      const result = await CustomerService.deleteDownload(req.user.id, id)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async clearDownloads(req, res, next) {
    try {
      const result = await CustomerService.clearDownloads(req.user.id)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default CustomerController
