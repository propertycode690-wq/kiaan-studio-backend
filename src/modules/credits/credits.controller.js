import { CreditsService } from './credits.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class CreditsController {
  static async getBalance(req, res, next) {
    try {
      const balance = await CreditsService.getBalance(req.user.id)
      return apiResponse.success(res, balance, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getUsageHistory(req, res, next) {
    try {
      const { days } = req.query
      const result = await CreditsService.getUsageHistory(req.user.id, { days })
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getPricing(req, res, next) {
    try {
      const pricing = CreditsService.getPricing()
      return apiResponse.success(res, pricing, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getTransactions(req, res, next) {
    try {
      const { category, type, page, limit } = req.query
      const result = await CreditsService.getTransactions(req.user.id, {
        category,
        type,
        page,
        limit
      })
      return apiResponse.success(res, result.transactions, 200, {
        pagination: result.pagination
      })
    } catch (error) {
      next(error)
    }
  }

  static async createTopUpOrder(req, res, next) {
    try {
      const { packId } = req.body
      const order = await CreditsService.createTopUpOrder(req.user.id, { packId })
      return apiResponse.success(res, order, 201, { message: 'Order created successfully' })
    } catch (error) {
      next(error)
    }
  }
}

export default CreditsController
