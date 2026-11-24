import { UsersService } from './users.service.js'
import { apiResponse } from '../../utils/apiResponse.js'

export class UsersController {
  static async getProfile(req, res, next) {
    try {
      const profile = await UsersService.getProfile(req.user.id)
      return apiResponse.success(res, profile, 200, { message: 'Profile retrieved' })
    } catch (error) {
      next(error)
    }
  }

  static async updateProfile(req, res, next) {
    try {
      const { fullName, bio, avatarUrl } = req.body
      const updated = await UsersService.updateProfile(req.user.id, {
        fullName,
        bio,
        avatarUrl
      })
      return apiResponse.success(res, updated, 200, { message: 'Profile updated successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async changePassword(req, res, next) {
    try {
      const currPassword = req.body.currPassword || req.body.currentPassword
      const newPassword = req.body.newPassword
      const result = await UsersService.changePassword(req.user.id, {
        currPassword,
        newPassword
      })
      return apiResponse.success(res, result, 200, { message: 'Password updated successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async getPreferences(req, res, next) {
    try {
      const prefs = await UsersService.getPreferences(req.user.id)
      return apiResponse.success(res, prefs, 200)
    } catch (error) {
      next(error)
    }
  }

  static async updatePreferences(req, res, next) {
    try {
      const prefs = await UsersService.updatePreferences(req.user.id, req.body)
      return apiResponse.success(res, prefs, 200, { message: 'Preferences updated successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async listApiKeys(req, res, next) {
    try {
      const keys = await UsersService.listApiKeys(req.user.id)
      return apiResponse.success(res, keys, 200)
    } catch (error) {
      next(error)
    }
  }

  static async createApiKey(req, res, next) {
    try {
      const { name } = req.body
      const newKey = await UsersService.createApiKey(req.user.id, { name })
      return apiResponse.success(res, newKey, 201, { message: 'API key created successfully' })
    } catch (error) {
      next(error)
    }
  }

  static async deleteApiKey(req, res, next) {
    try {
      const { keyId } = req.params
      const result = await UsersService.deleteApiKey(req.user.id, keyId)
      return apiResponse.success(res, result, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default UsersController
