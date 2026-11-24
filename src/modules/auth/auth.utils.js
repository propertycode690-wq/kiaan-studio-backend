import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

const BCRYPT_SALT_ROUNDS = 12

export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return ''
  return email.trim().toLowerCase()
}

export async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string')
  }
  return bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS)
}

export async function comparePassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false
  return bcrypt.compare(plainPassword, passwordHash)
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateAccessToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role
  }
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN
  })
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET)
}

export function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex')
}

export function getRefreshTokenExpiry(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

export function sanitizeUser(user) {
  if (!user) return null
  const { passwordHash, ...safeUser } = user
  return safeUser
}
