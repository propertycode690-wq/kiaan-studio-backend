import { prisma } from '../../config/database.js'
import { AuditService } from '../admin/audit.service.js'
import { logger } from '../../utils/logger.js'
import {
  hashPassword,
  comparePassword,
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
  sanitizeUser,
  normalizeEmail
} from './auth.utils.js'

export class AuthService {
  /**
   * Registers a new customer (CREATOR role only)
   */
  static async registerCustomer({ email, password, fullName }) {
    const normalizedEmail = normalizeEmail(email)

    // Reject duplicate email registrations
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    })

    if (existing) {
      const error = new Error('An account with this email already exists')
      error.statusCode = 409
      error.code = 'EMAIL_ALREADY_EXISTS'
      throw error
    }

    const passwordHash = await hashPassword(password)

    // Atomic transaction: create User, dynamic CreditWallet, and starter credit transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch dynamic starter credits from system settings
      let starterCredits = 50 // Safe platform fallback if setting does not exist
      const settingRecord = await tx.systemSetting.findUnique({
        where: { key: 'defaultFreeCredits' }
      })

      if (settingRecord && settingRecord.value !== undefined && settingRecord.value !== null) {
        let parsedNum = NaN
        try {
          const parsedJson = JSON.parse(settingRecord.value)
          if (typeof parsedJson === 'number') {
            parsedNum = parsedJson
          }
        } catch {}

        if (isNaN(parsedNum)) {
          parsedNum = parseInt(settingRecord.value, 10)
        }

        if (!isNaN(parsedNum) && parsedNum >= 0) {
          starterCredits = Math.floor(parsedNum)
        }
      }

      // 2. Create customer User
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName,
          role: 'CREATOR', // Public registration is strictly CREATOR / CUSTOMER
          status: 'ACTIVE'
        }
      })

      // 3. Grant dynamic starter credits in credit wallet
      const wallet = await tx.creditWallet.create({
        data: {
          userId: user.id,
          balance: starterCredits,
          reservedBalance: 0
        }
      })

      // 4. Create initial credit ledger entry using the same amount
      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          amount: starterCredits,
          type: 'CREDIT',
          category: 'ADMIN_GRANT',
          description: 'Welcome starter credits'
        }
      })

      return { user, wallet }
    })

    // Generate tokens
    const accessToken = generateAccessToken(result.user)
    const rawRefreshToken = generateRefreshToken()
    const tokenHash = hashToken(rawRefreshToken)

    await prisma.refreshToken.create({
      data: {
        userId: result.user.id,
        tokenHash,
        expiresAt: getRefreshTokenExpiry(7)
      }
    })

    return {
      user: {
        ...sanitizeUser(result.user),
        creditBalance: result.wallet.balance
      },
      accessToken,
      refreshToken: rawRefreshToken
    }
  }

  /**
   * Authenticates user credentials (Customer or Admin)
   */
  static async loginUser({ email, password, requestedAdmin = false, clientIp = null, userAgent = null }) {
    const normalizedEmail = normalizeEmail(email)

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { wallet: true }
    })

    // Generic error to prevent email enumeration
    if (!user) {
      const error = new Error('Invalid email or password')
      error.statusCode = 401
      error.code = 'INVALID_CREDENTIALS'
      throw error
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash)
    if (!isPasswordValid) {
      const error = new Error('Invalid email or password')
      error.statusCode = 401
      error.code = 'INVALID_CREDENTIALS'
      throw error
    }

    // Account status enforcement
    if (user.status === 'BANNED') {
      const error = new Error('This account has been banned. Please contact support.')
      error.statusCode = 403
      error.code = 'ACCOUNT_BANNED'
      throw error
    }

    if (user.status === 'SUSPENDED') {
      const error = new Error('This account is currently suspended. Please contact support.')
      error.statusCode = 403
      error.code = 'ACCOUNT_SUSPENDED'
      throw error
    }

    // Strict Portal Authorization Guards
    const isUserAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'

    // Rule 1: Admin portal requires administrator privileges
    if (requestedAdmin && !isUserAdmin) {
      const error = new Error('Access denied: Administrative privileges required. Please use User Login.')
      error.statusCode = 403
      error.code = 'FORBIDDEN'
      throw error
    }

    // Rule 2: User portal requires customer credentials (admins must use Admin Login)
    if (!requestedAdmin && isUserAdmin) {
      const error = new Error('This account has administrator privileges. Please switch to Admin Login.')
      error.statusCode = 403
      error.code = 'ADMIN_REDIRECT_REQUIRED'
      throw error
    }

    // Task B: Record successful login audit event (safe, non-blocking)
    AuditService.log({
      actorId: user.id,
      action: isUserAdmin ? 'ADMIN_LOGIN' : 'USER_LOGIN',
      targetEntity: 'AUTH',
      targetId: user.id,
      ipAddress: clientIp ? String(clientIp).slice(0, 45) : null,
      diffJson: {
        role: user.role,
        portal: requestedAdmin ? 'ADMIN' : 'CUSTOMER',
        authMethod: 'PASSWORD_BCRYPT',
        ...(userAgent ? { userAgent: String(userAgent).slice(0, 255) } : {})
      }
    }).catch(err => {
      logger.error('Failed to record login audit log:', err)
    })

    // Generate session tokens
    const accessToken = generateAccessToken(user)
    const rawRefreshToken = generateRefreshToken()
    const tokenHash = hashToken(rawRefreshToken)

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: getRefreshTokenExpiry(7)
      }
    })

    return {
      user: {
        ...sanitizeUser(user),
        creditBalance: user.wallet?.balance ?? 0
      },
      accessToken,
      refreshToken: rawRefreshToken
    }
  }

  /**
   * Rotates refresh token with reuse detection
   */
  static async refreshSession(refreshTokenString) {
    if (!refreshTokenString || typeof refreshTokenString !== 'string') {
      const error = new Error('Refresh token is required')
      error.statusCode = 400
      error.code = 'TOKEN_MISSING'
      throw error
    }

    const hashedInput = hashToken(refreshTokenString)

    const existingToken = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashedInput },
      include: { user: { include: { wallet: true } } }
    })

    if (!existingToken) {
      const error = new Error('Invalid or unrecognized refresh token')
      error.statusCode = 401
      error.code = 'INVALID_REFRESH_TOKEN'
      throw error
    }

    // REUSE DETECTION: If an already-revoked token is presented, compromise is suspected
    if (existingToken.revokedAt !== null) {
      // Invalidate all tokens for this user immediately
      await prisma.refreshToken.updateMany({
        where: {
          userId: existingToken.userId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      })

      const error = new Error('Suspicious token activity detected. All active sessions have been revoked.')
      error.statusCode = 401
      error.code = 'TOKEN_REUSE_DETECTED'
      throw error
    }

    // Expiration check
    if (new Date(existingToken.expiresAt) < new Date()) {
      const error = new Error('Refresh token has expired. Please log in again.')
      error.statusCode = 401
      error.code = 'TOKEN_EXPIRED'
      throw error
    }

    // User status check
    const { user } = existingToken
    if (user.status !== 'ACTIVE') {
      const error = new Error(`Account is ${user.status.toLowerCase()}`)
      error.statusCode = 403
      error.code = 'ACCOUNT_INACTIVE'
      throw error
    }

    // Perform rotation inside transaction
    const newRawRefreshToken = generateRefreshToken()
    const newTokenHash = hashToken(newRawRefreshToken)

    await prisma.$transaction([
      // Revoke the old token
      prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: new Date() }
      }),
      // Create the rotated token
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newTokenHash,
          expiresAt: getRefreshTokenExpiry(7)
        }
      })
    ])

    const newAccessToken = generateAccessToken(user)

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      user: {
        ...sanitizeUser(user),
        creditBalance: user.wallet?.balance ?? 0
      }
    }
  }

  /**
   * Logs out user and revokes refresh session
   */
  static async logoutUser(refreshTokenString) {
    if (!refreshTokenString) return false

    const hashedInput = hashToken(refreshTokenString)

    await prisma.refreshToken.updateMany({
      where: {
        tokenHash: hashedInput,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    })

    return true
  }

  /**
   * Retrieves current authenticated user profile
   */
  static async getCurrentUser(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true }
    })

    if (!user) {
      const error = new Error('User not found')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      throw error
    }

    return {
      ...sanitizeUser(user),
      creditBalance: user.wallet?.balance ?? 0
    }
  }
}

export default AuthService
