import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { env } from '../config/env.js'

/**
 * Parses image format, MIME type, and dimensions from raw buffer without external binary dependencies.
 */
export function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 8) return null

  // 1. PNG Signature: \x89PNG\r\n\x1a\n
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16)
      const height = buffer.readUInt32BE(20)
      return { format: 'png', mimeType: 'image/png', width, height }
    }
    return { format: 'png', mimeType: 'image/png', width: 1024, height: 1024 }
  }

  // 2. JPEG Signature: \xff\xd8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset < buffer.length - 8) {
      while (buffer[offset] === 0xff && offset < buffer.length) offset++
      const marker = buffer[offset++]

      // End of Image or Start of Scan
      if (marker === 0xd9 || marker === 0xda) break

      const len = buffer.readUInt16BE(offset)
      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker >= 0xc0 && marker <= 0xc3 && marker !== 0xc4) {
        const height = buffer.readUInt16BE(offset + 3)
        const width = buffer.readUInt16BE(offset + 5)
        return { format: 'jpg', mimeType: 'image/jpeg', width, height }
      }
      offset += len
    }
    return { format: 'jpg', mimeType: 'image/jpeg', width: 1024, height: 1024 }
  }

  // 3. WebP Signature: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { format: 'webp', mimeType: 'image/webp', width: 1024, height: 1024 }
  }

  return null
}

/**
 * Validates an image buffer according to Kiaan Studio security & model specifications.
 */
export function validateImageBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const error = new Error('Invalid image buffer provided')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  // File size validation (100 bytes minimum to 10MB maximum)
  const MAX_SIZE_BYTES = 10 * 1024 * 1024
  const MIN_SIZE_BYTES = 100

  if (buffer.length < MIN_SIZE_BYTES) {
    const error = new Error('Reference image is empty or corrupted')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  if (buffer.length > MAX_SIZE_BYTES) {
    const error = new Error(`Reference image exceeds maximum allowed size of 10MB (${(buffer.length / (1024 * 1024)).toFixed(1)}MB)`)
    error.statusCode = 400
    error.code = 'FILE_TOO_LARGE'
    throw error
  }

  const meta = getImageDimensions(buffer)
  if (!meta) {
    const error = new Error('Unsupported image format. Allowed formats: JPEG, PNG, WebP.')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  // Dimension validation
  if (meta.width < 64 || meta.height < 64 || meta.width > 4096 || meta.height > 4096) {
    const error = new Error(`Image dimensions (${meta.width}x${meta.height}) out of supported bounds (min 64x64, max 4096x4096)`)
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  return {
    ...meta,
    sizeBytes: buffer.length
  }
}

/**
 * Ingests, validates and persists a reference image input (Base64 data URL or local path).
 */
export function processAndSaveReferenceImage(rawInput, userId = 'default') {
  if (!rawInput || typeof rawInput !== 'string') {
    const error = new Error('Reference image is required for Image-to-Image generation.')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  let buffer
  let sourceFormat = 'jpg'

  if (rawInput.startsWith('data:image/')) {
    const match = rawInput.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/)
    if (!match) {
      const error = new Error('Invalid base64 image data URL format')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }
    const rawFormat = match[1].toLowerCase()
    sourceFormat = rawFormat === 'jpeg' ? 'jpg' : rawFormat
    buffer = Buffer.from(match[2], 'base64')
  } else if (rawInput.startsWith('/uploads/') || rawInput.startsWith('uploads/')) {
    const localRel = rawInput.startsWith('/') ? rawInput.slice(1) : rawInput
    const relWithoutUploads = localRel.replace(/^uploads\/?/, '')
    const candidatePaths = [
      path.resolve(env.UPLOADS_DIR, relWithoutUploads),
      path.resolve(process.cwd(), localRel),
      path.resolve(process.cwd(), 'uploads', relWithoutUploads)
    ]
    const absPath = candidatePaths.find(p => fs.existsSync(p))
    if (!absPath) {
      const error = new Error(`Referenced image file not found on server: ${rawInput}`)
      error.statusCode = 404
      error.code = 'FILE_NOT_FOUND'
      throw error
    }
    buffer = fs.readFileSync(absPath)
  } else if (rawInput.startsWith('/images/') || rawInput.startsWith('images/')) {
    // Frontend public sample images
    const rel = rawInput.startsWith('/') ? rawInput.slice(1) : rawInput
    const candidatePaths = [
      path.resolve(process.cwd(), '../Kiaan-ai-image-generator-frontend/public', rel),
      path.resolve(process.cwd(), 'uploads', rel),
      path.resolve(process.cwd(), 'public', rel)
    ]
    const foundPath = candidatePaths.find(p => fs.existsSync(p))
    if (!foundPath) {
      const error = new Error(`Sample reference image not found on server: ${rawInput}`)
      error.statusCode = 404
      error.code = 'FILE_NOT_FOUND'
      throw error
    }
    buffer = fs.readFileSync(foundPath)
  } else {
    const error = new Error('Unsupported reference image input. Must be a base64 Data URL or internal storage path.')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  // Validate format, size, and bounds
  const validatedMeta = validateImageBuffer(buffer)

  // Persist to backend/uploads/inputs/
  const inputsDir = path.resolve(env.UPLOADS_DIR, 'inputs')
  fs.mkdirSync(inputsDir, { recursive: true })

  const uniqueId = crypto.randomUUID ? crypto.randomUUID() : Date.now()
  const fileName = `ref_${userId.slice(0, 8)}_${uniqueId}.${validatedMeta.format}`
  const filePath = path.join(inputsDir, fileName)
  fs.writeFileSync(filePath, buffer)

  return {
    storagePath: `/uploads/inputs/${fileName}`,
    absolutePath: filePath,
    mimeType: validatedMeta.mimeType,
    format: validatedMeta.format,
    width: validatedMeta.width,
    height: validatedMeta.height,
    sizeBytes: validatedMeta.sizeBytes
  }
}
