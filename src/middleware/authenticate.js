import { verifyAccessToken, sanitizeUser } from '../modules/auth/auth.utils.js'
import { apiResponse } from '../utils/apiResponse.js'
import { prisma } from '../config/database.js'

export async function authenticate(req, res, next) {
  try {
    let token = null
    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim()
    } else if (req.cookies?.kiaan_access_token) {
      token = req.cookies.kiaan_access_token
    }

    if (!token) {
      return apiResponse.error(
        res,
        'Authentication required. No token provided.',
        401,
        'UNAUTHORIZED'
      )
    }

    let decoded
    try {
      decoded = verifyAccessToken(token)
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return apiResponse.error(res, 'Access token has expired', 401, 'TOKEN_EXPIRED')
      }
      return apiResponse.error(res, 'Invalid or malformed access token', 401, 'INVALID_TOKEN')
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { wallet: true }
    })

    if (!user) {
      return apiResponse.error(res, 'User account no longer exists', 401, 'USER_NOT_FOUND')
    }

    if (user.status === 'BANNED') {
      return apiResponse.error(
        res,
        'Account is banned. Access revoked.',
        403,
        'ACCOUNT_BANNED'
      )
    }

    if (user.status === 'SUSPENDED') {
      return apiResponse.error(
        res,
        'Account is suspended. Access revoked.',
        403,
        'ACCOUNT_SUSPENDED'
      )
    }

    req.user = {
      ...sanitizeUser(user),
      creditBalance: user.wallet?.balance ?? 0
    }

    next()
  } catch (error) {
    next(error)
  }
}

export default authenticate
