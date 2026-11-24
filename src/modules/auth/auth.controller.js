import { AuthService } from './auth.service.js'
import { apiResponse } from '../../utils/apiResponse.js'
import { env } from '../../config/env.js'

const REFRESH_COOKIE_NAME = 'kiaan_refresh_token'

const getCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
})

const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  path: '/'
})

export class AuthController {
  static async register(req, res, next) {
    try {
      const { email, password, fullName } = req.body
      const result = await AuthService.registerCustomer({ email, password, fullName })

      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions())

      return apiResponse.success(
        res,
        {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        },
        201
      )
    } catch (error) {
      next(error)
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password, requestedAdmin } = req.body
      const clientIp = req.ip || req.socket?.remoteAddress || null
      const userAgent = req.headers['user-agent'] || null

      const result = await AuthService.loginUser({
        email,
        password,
        requestedAdmin: Boolean(requestedAdmin),
        clientIp,
        userAgent
      })

      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions())

      return apiResponse.success(
        res,
        {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        },
        200
      )
    } catch (error) {
      next(error)
    }
  }

  static async refresh(req, res, next) {
    try {
      const refreshToken =
        req.cookies?.[REFRESH_COOKIE_NAME] ||
        req.body?.refreshToken ||
        req.headers['x-refresh-token']

      const result = await AuthService.refreshSession(refreshToken)

      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions())

      return apiResponse.success(
        res,
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user
        },
        200
      )
    } catch (error) {
      next(error)
    }
  }

  static async logout(req, res, next) {
    try {
      const refreshToken =
        req.cookies?.[REFRESH_COOKIE_NAME] ||
        req.body?.refreshToken ||
        req.headers['x-refresh-token']

      await AuthService.logoutUser(refreshToken)

      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions())

      return apiResponse.success(res, { message: 'Logged out successfully' }, 200)
    } catch (error) {
      next(error)
    }
  }

  static async getMe(req, res, next) {
    try {
      const user = await AuthService.getCurrentUser(req.user.id)
      return apiResponse.success(res, { user }, 200)
    } catch (error) {
      next(error)
    }
  }
}

export default AuthController
