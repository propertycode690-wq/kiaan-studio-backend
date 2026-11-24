import { SubscriptionsService } from './subscriptions.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class SubscriptionsController {
  static async listPlans(req, res, next) {
    try {
      const plans = await SubscriptionsService.listPlans()
      return apiResponse.success(res, plans, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getCurrentSubscription(req, res, next) {
    try {
      const sub = await SubscriptionsService.getCurrentSubscription(req.user.id)
      return apiResponse.success(res, sub, 200)
    } catch (error) {
      next(error)
    }
  }

  static async createOrder(req, res, next) {
    try {
      const { planSlug, billingCycle } = req.body
      const order = await SubscriptionsService.createSubscriptionOrder(req.user.id, {
        planSlug,
        billingCycle
      })
      return apiResponse.success(res, order, 201, { message: 'Subscription order created' })
    } catch (error) {
      next(error)
    }
  }

  static async listInvoices(req, res, next) {
    try {
      const invoices = await SubscriptionsService.listInvoices(req.user.id)
      return apiResponse.success(res, invoices, 200)
    } catch (error) {
      next(error)
    }
  }

  static async handleWebhook(req, res, next) {
    try {
      const signature = req.headers['x-webhook-signature'] || req.headers['stripe-signature']
      const result = await SubscriptionsService.handleWebhook(req.body, signature)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default SubscriptionsController
