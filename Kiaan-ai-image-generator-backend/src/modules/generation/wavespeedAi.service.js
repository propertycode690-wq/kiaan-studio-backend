import fs from 'fs'
import path from 'path'
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'

const ASPECT_RATIO_MAP = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '4:3': { width: 1152, height: 864 },
  '3:4': { width: 864, height: 1152 },
  '21:9': { width: 1536, height: 640 }
}

export class WavespeedAiService {
  /**
   * Check if WaveSpeed credentials are configured in environment
   */
  static isConfigured() {
    const key = process.env.WAVESPEED_API_KEY || env.WAVESPEED_API_KEY
    return Boolean(key && key.trim().length > 5)
  }

  /**
   * Get API Key securely
   */
  static getApiKey() {
    const key = (process.env.WAVESPEED_API_KEY || env.WAVESPEED_API_KEY || '').trim()
    if (!key) {
      throw new Error('[WaveSpeed AI Error] Missing WAVESPEED_API_KEY in backend environment.')
    }
    return key
  }

  /**
   * Parse width and height from parameters or aspect ratio
   */
  static parseDimensions(aspect = '1:1', rawWidth = null, rawHeight = null) {
    const cleanAspect = String(aspect || '1:1').trim()
    const ratioMatch = cleanAspect.match(/(\d+)\s*:\s*(\d+)/)
    const ratioKey = ratioMatch ? `${ratioMatch[1]}:${ratioMatch[2]}` : cleanAspect

    if (ASPECT_RATIO_MAP[ratioKey]) {
      return ASPECT_RATIO_MAP[ratioKey]
    }
    if (ASPECT_RATIO_MAP[cleanAspect]) {
      return ASPECT_RATIO_MAP[cleanAspect]
    }
    if (rawWidth && rawHeight) {
      return {
        width: Math.min(1536, Math.max(256, parseInt(rawWidth, 10) || 1024)),
        height: Math.min(1536, Math.max(256, parseInt(rawHeight, 10) || 1024))
      }
    }
    return { width: 1024, height: 1024 }
  }

  /**
   * Execute real Z-Image Turbo image generation via WaveSpeed AI API
   */
  static async generateImage({ prompt, parameters = {}, jobId = 'default', onProgress = null }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('[WaveSpeed AI Error] Prompt is required for image generation.')
    }

    const apiKey = this.getApiKey()
    const submitUrl = 'https://api.wavespeed.ai/api/v3/wavespeed-ai/z-image/turbo'
    const dims = this.parseDimensions(parameters.aspect || parameters.aspectRatio, parameters.width, parameters.height)

    const payload = {
      prompt: prompt.trim(),
      size: `${dims.width}*${dims.height}`,
      strength: 0.6,
      output_format: 'jpeg'
    }

    if (parameters.seed !== undefined && parameters.seed !== null && parameters.seed !== '') {
      const parsedSeed = parseInt(parameters.seed, 10)
      if (!isNaN(parsedSeed)) {
        payload.seed = Math.abs(parsedSeed) % (2 ** 32 - 1)
      }
    }

    const startTime = Date.now()
    logger.info(`[WaveSpeed AI] Calling Z-Image Turbo for Job #${jobId}...`)

    if (onProgress) {
      await onProgress(25, 'Submitting task to WaveSpeed AI...')
    }

    let submitResponse
    try {
      submitResponse = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (networkErr) {
      logger.error(`[WaveSpeed AI] Network request failed: ${networkErr.message}`)
      throw new Error(`[WaveSpeed AI Network Error] Failed to reach WaveSpeed AI API: ${networkErr.message}`)
    }

    if (!submitResponse.ok) {
      let errBody = ''
      try {
        errBody = await submitResponse.text()
      } catch {
        errBody = `HTTP ${submitResponse.status}`
      }

      if (/flagged|content moderation|safety|nsfw/i.test(errBody)) {
        logger.warn(`[WaveSpeed AI] Job #${jobId} flagged by content safety filter (HTTP ${submitResponse.status})`)
        const flaggedError = new Error('The AI safety filter flagged the generated output for this prompt. Please try a different description or prompt variation.')
        flaggedError.code = 'CONTENT_OUTPUT_FLAGGED'
        flaggedError.statusCode = 400
        flaggedError.isFlagged = true
        throw flaggedError
      }

      throw new Error(`[WaveSpeed AI Error] API submission failed with HTTP ${submitResponse.status}: ${errBody}`)
    }

    const submitData = await submitResponse.json()
    const taskData = submitData?.data || submitData
    const predictionId = taskData?.id

    if (!predictionId) {
      throw new Error(`[WaveSpeed AI Error] Prediction ID missing from response: ${JSON.stringify(submitData)}`)
    }

    logger.info(`[WaveSpeed AI] Task submitted successfully (Prediction ID: ${predictionId}). Polling result...`)

    if (onProgress) {
      await onProgress(40, `WaveSpeed task queued (${predictionId.slice(0, 8)})...`)
    }

    const resultUrl = `https://api.wavespeed.ai/api/v3/predictions/${predictionId}/result`
    const pollHeaders = {
      Authorization: `Bearer ${apiKey}`
    }

    let completedResult = null
    const maxAttempts = 120 // up to ~180 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500))

      let pollResponse
      try {
        pollResponse = await fetch(resultUrl, {
          method: 'GET',
          headers: pollHeaders
        })
      } catch (pollNetErr) {
        logger.warn(`[WaveSpeed AI Warning] Polling network glitch on attempt ${attempt}: ${pollNetErr.message}`)
        continue
      }

      if (!pollResponse.ok) {
        const pollErrText = await pollResponse.text().catch(() => '')
        logger.warn(`[WaveSpeed AI Warning] Polling HTTP ${pollResponse.status}: ${pollErrText}`)
        continue
      }

      const pollBody = await pollResponse.json().catch(() => null)
      if (!pollBody) continue

      const result = pollBody?.data || pollBody
      const status = result?.status

      const pct = Math.min(85, 40 + attempt * 2)
      if (onProgress) {
        await onProgress(pct, `WaveSpeed AI synthesizing (${status || 'processing'})...`)
      }

      if (status === 'completed') {
        completedResult = result
        break
      }

      if (['failed', 'cancelled', 'timeout', 'deleted'].includes(status)) {
        const errorDetail = result?.error || status
        if (/flagged|content moderation|safety|nsfw/i.test(String(errorDetail))) {
          const flaggedError = new Error('The AI safety filter flagged the generated output for this prompt. Please try a different description or prompt variation.')
          flaggedError.code = 'CONTENT_OUTPUT_FLAGGED'
          flaggedError.statusCode = 400
          flaggedError.isFlagged = true
          throw flaggedError
        }
        throw new Error(`[WaveSpeed AI Error] Generation ended with status '${status}': ${errorDetail}`)
      }
    }

    if (!completedResult) {
      throw new Error('[WaveSpeed AI Error] Polling timeout reached before generation completed.')
    }

    const outputs = completedResult.outputs || completedResult.output
    if (!outputs || (Array.isArray(outputs) && outputs.length === 0)) {
      throw new Error(`[WaveSpeed AI Error] Generation completed but returned empty outputs: ${JSON.stringify(completedResult)}`)
    }

    const imageUrl = Array.isArray(outputs) ? outputs[0] : String(outputs)
    logger.info(`[WaveSpeed AI] Downloading output asset from: ${imageUrl}`)

    if (onProgress) {
      await onProgress(90, 'Downloading high-resolution JPEG asset...')
    }

    const imageResponse = await fetch(imageUrl, {
      headers: { 'User-Agent': 'KiaanStudio/1.0' }
    })

    if (!imageResponse.ok) {
      throw new Error(`[WaveSpeed AI Error] Failed to download generated image asset (HTTP ${imageResponse.status})`)
    }

    const arrayBuffer = await imageResponse.arrayBuffer()
    const imageBuffer = Buffer.from(arrayBuffer)

    if (!imageBuffer || imageBuffer.length < 100) {
      throw new Error('[WaveSpeed AI Error] Received empty or corrupted image data from WaveSpeed.')
    }

    // Save image asset to backend/uploads/generations
    const uploadsDir = path.resolve(env.UPLOADS_DIR, 'generations')
    fs.mkdirSync(uploadsDir, { recursive: true })

    const fileName = `gen_${jobId}_${Date.now()}.jpg`
    const filePath = path.join(uploadsDir, fileName)
    fs.writeFileSync(filePath, imageBuffer)

    const latencyMs = Date.now() - startTime
    const storagePath = `/uploads/generations/${fileName}`
    logger.info(`[WaveSpeed AI] Z-Image Turbo synthesized and saved: ${storagePath} (${imageBuffer.length} bytes in ${latencyMs}ms)`)

    return {
      storagePath,
      thumbnailPath: storagePath,
      dimensions: `${dims.width}x${dims.height}`,
      fileSizeBytes: imageBuffer.length,
      mediaType: 'IMAGE',
      executionTimeMs: latencyMs,
      modelId: 'z-image-turbo'
    }
  }
}

export default WavespeedAiService
