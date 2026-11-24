import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendEnvPath = path.resolve(__dirname, '../../.env')

// Load environment variables from .env file (both default and explicit backend path)
dotenv.config()
dotenv.config({ path: backendEnvPath })

/**
 * Validates and exposes environment variables.
 * Fails fast on server startup if critical configuration is missing.
 */
function validateEnv() {
  const required = [
    'PORT',
    'DATABASE_URL',
    'FRONTEND_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ]
  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(
      `[Startup Error] Missing required environment variables: ${missing.join(', ')}`
    )
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '5001', 10),
    DATABASE_URL: process.env.DATABASE_URL,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    WORKER_SECRET: process.env.WORKER_SECRET || 'kiaan_worker_secret_dev_2026',
    WAVESPEED_API_KEY: process.env.WAVESPEED_API_KEY,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
    ENABLE_AI_WORKER: process.env.ENABLE_AI_WORKER === 'true',
    UPLOADS_DIR: process.env.UPLOADS_DIR
      ? path.resolve(process.env.UPLOADS_DIR)
      : (fs.existsSync(path.resolve(__dirname, '../../uploads'))
          ? path.resolve(__dirname, '../../uploads')
          : path.resolve(process.cwd(), 'uploads')),
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || '',
    CLOUDFLARE_IMG2IMG_ACCOUNT_ID: process.env.CLOUDFLARE_IMG2IMG_ACCOUNT_ID || '',
    CLOUDFLARE_IMG2IMG_API_TOKEN: process.env.CLOUDFLARE_IMG2IMG_API_TOKEN || '',
    CLOUDFLARE_INFERENCE_MODE: process.env.CLOUDFLARE_INFERENCE_MODE || 'live',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production'
  }
}

export const env = validateEnv()
export default env
