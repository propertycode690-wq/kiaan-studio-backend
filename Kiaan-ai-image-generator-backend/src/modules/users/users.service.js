import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { hashPassword, comparePassword, sanitizeUser } from '../auth/auth.utils.js'

export class UsersService {
  /**
   * Retrieves full profile of the authenticated user
   */
  static async getProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1
        }
      }
    })

    if (!user) {
      const error = new Error('User not found')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      throw error
    }

    const activeSubscription = user.subscriptions[0] || null

    return {
      ...sanitizeUser(user),
      creditBalance: user.wallet?.balance ?? 0,
      reservedCredits: user.wallet?.reservedBalance ?? 0,
      tier: activeSubscription?.plan?.name || (user.role === 'SUPER_ADMIN' ? 'Enterprise Admin' : 'Free Tier')
    }
  }

  /**
   * Updates profile information (fullName, bio, avatarUrl)
   */
  static async updateProfile(userId, { fullName, bio, avatarUrl }) {
    const data = {}
    if (fullName !== undefined) {
      if (!fullName.trim() || fullName.trim().length < 2) {
        const error = new Error('Full name must be at least 2 characters')
        error.statusCode = 400
        error.code = 'VALIDATION_ERROR'
        throw error
      }
      data.fullName = fullName.trim()
    }

    if (bio !== undefined) {
      data.bio = bio ? String(bio).trim() : null
    }

    if (avatarUrl !== undefined) {
      if (!avatarUrl) {
        data.avatarUrl = null
      } else if (avatarUrl.startsWith('data:image/')) {
        // Base64 Data URL handling: decode and save to local storage
        try {
          const match = avatarUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/)
          if (!match) {
            const error = new Error('Invalid image data URL format')
            error.statusCode = 400
            error.code = 'VALIDATION_ERROR'
            throw error
          }
          const rawExt = match[1].toLowerCase()
          const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
          const base64Data = match[2]
          const buffer = Buffer.from(base64Data, 'base64')

          // Max 5MB file size limit
          if (buffer.length > 5 * 1024 * 1024) {
            const error = new Error('Avatar image exceeds 5MB limit')
            error.statusCode = 400
            error.code = 'FILE_TOO_LARGE'
            throw error
          }

          const uploadDir = path.resolve(env.UPLOADS_DIR, 'avatars')
          fs.mkdirSync(uploadDir, { recursive: true })

          const filename = `avatar_${userId}_${Date.now()}.${ext}`
          const filePath = path.join(uploadDir, filename)
          fs.writeFileSync(filePath, buffer)

          data.avatarUrl = `/uploads/avatars/${filename}`
        } catch (err) {
          if (err.statusCode) throw err
          const error = new Error('Failed to process avatar image')
          error.statusCode = 400
          error.code = 'AVATAR_PROCESSING_FAILED'
          throw error
        }
      } else {
        const trimmed = String(avatarUrl).trim()
        if (trimmed.length > 512) {
          const error = new Error('Avatar URL exceeds maximum length of 512 characters')
          error.statusCode = 400
          error.code = 'VALIDATION_ERROR'
          throw error
        }
        data.avatarUrl = trimmed
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      include: { wallet: true }
    })

    return {
      ...sanitizeUser(updated),
      creditBalance: updated.wallet?.balance ?? 0
    }
  }

  /**
   * Changes user password
   */
  static async changePassword(userId, { currPassword, newPassword }) {
    if (!currPassword || !newPassword) {
      const error = new Error('Current password and new password are required')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (newPassword.length < 8) {
      const error = new Error('New password must be at least 8 characters long')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      const error = new Error('User not found')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      throw error
    }

    const isMatch = await comparePassword(currPassword, user.passwordHash)
    if (!isMatch) {
      const error = new Error('Current password is incorrect')
      error.statusCode = 400
      error.code = 'INVALID_CURRENT_PASSWORD'
      throw error
    }

    const newHash = await hashPassword(newPassword)
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash }
    })

    return { message: 'Password updated successfully' }
  }

  /**
   * Retrieves user preferences (notification settings)
   */
  static async getPreferences(userId) {
    const settingKey = `user_prefs_${userId}`
    const setting = await prisma.systemSetting.findUnique({
      where: { key: settingKey }
    })

    const defaultPrefs = {
      emailCompletedJobs: true,
      emailLowCredits: true,
      browserNotifications: true,
      emailProductUpdates: false,
      autoDownload: false
    }

    if (!setting) {
      return defaultPrefs
    }

    try {
      return { ...defaultPrefs, ...JSON.parse(setting.value) }
    } catch {
      return defaultPrefs
    }
  }

  /**
   * Persists user preferences
   */
  static async updatePreferences(userId, prefs) {
    const settingKey = `user_prefs_${userId}`
    const current = await this.getPreferences(userId)
    const merged = { ...current, ...prefs }

    await prisma.systemSetting.upsert({
      where: { key: settingKey },
      update: { value: JSON.stringify(merged) },
      create: { key: settingKey, value: JSON.stringify(merged) }
    })

    return merged
  }

  /**
   * Lists API keys for user
   */
  static async listApiKeys(userId) {
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        createdAt: true
      }
    })
    return keys.map((k) => ({
      ...k,
      environment: 'development',
      isDevelopmentOnly: true
    }))
  }

  /**
   * Creates a new API key for developer access (clearly marked development-only)
   */
  static async createApiKey(userId, { name }) {
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      const error = new Error('Key name must be at least 2 characters long')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    // Explicit development prefix: kiaan_dev_
    const rawKey = `kiaan_dev_${crypto.randomBytes(24).toString('hex')}`
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

    const created = await prisma.apiKey.create({
      data: {
        userId,
        name: name.trim(),
        keyHash
      }
    })

    return {
      id: created.id,
      name: created.name,
      apiKey: rawKey, // Displayed once upon creation
      environment: 'development',
      isDevelopmentOnly: true,
      prefix: 'kiaan_dev_',
      createdAt: created.createdAt
    }
  }

  /**
   * Revokes / deletes an API key
   */
  static async deleteApiKey(userId, keyId) {
    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, userId }
    })

    if (!existing) {
      const error = new Error('API key not found')
      error.statusCode = 404
      error.code = 'KEY_NOT_FOUND'
      throw error
    }

    await prisma.apiKey.delete({
      where: { id: keyId }
    })

    return { message: 'API key revoked successfully' }
  }
}

export default UsersService
