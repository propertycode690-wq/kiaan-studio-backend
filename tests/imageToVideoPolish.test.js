import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('KIAAN STUDIO — IMAGE-TO-VIDEO UI POLISH VERIFICATION', () => {
  const i2vPagePath = path.resolve(
    __dirname,
    '../../Kiaan-ai-image-generator-frontend/src/pages/customer/ImageToVideoPage.jsx'
  )

  it('1. ImageToVideoPage.jsx file exists and is readable', () => {
    assert.strictEqual(fs.existsSync(i2vPagePath), true, 'ImageToVideoPage.jsx must exist')
  })

  const fileContent = fs.readFileSync(i2vPagePath, 'utf-8')

  it('2. Top Header matches studio theme with "Coming Soon" badge, credits, and cost per video', () => {
    assert.ok(fileContent.includes('Creation Studio'), 'Header must contain Creation Studio breadcrumb')
    assert.ok(fileContent.includes('AI Image-to-Video Studio'), 'Header title must be AI Image-to-Video Studio')
    assert.ok(fileContent.includes('Coming Soon'), 'Header must display Coming Soon badge')
    assert.ok(fileContent.includes('Available Credits'), 'Header must display user Available Credits')
    assert.ok(fileContent.includes('Cost per video'), 'Header must state cost per video')
  })

  it('3. First Row uses two equal columns with dynamic master-follower height sync', () => {
    assert.ok(fileContent.includes('grid grid-cols-1 lg:grid-cols-2'), 'Must use 2-column responsive grid')
    assert.ok(fileContent.includes('canvasCardRef'), 'Must reference canvasCardRef for height measurement')
    assert.ok(fileContent.includes('promptCardRef'), 'Must reference promptCardRef for height synchronization')
    assert.ok(fileContent.includes('ResizeObserver'), 'Must use ResizeObserver for seamless responsive alignment')
  })

  it('4. Image upload supports drag-and-drop, validation, replace, remove, and object URL cleanup', () => {
    assert.ok(fileContent.includes('onDragOver'), 'Must handle drag over')
    assert.ok(fileContent.includes('onDrop'), 'Must handle file drop')
    assert.ok(fileContent.includes('processFile'), 'Must validate and process files')
    assert.ok(fileContent.includes('20 * 1024 * 1024'), 'Must validate 20MB file limit')
    assert.ok(fileContent.includes('URL.revokeObjectURL'), 'Must clean up object URLs to prevent memory leaks')
    assert.ok(fileContent.includes('Replace'), 'Must provide Replace action')
    assert.ok(fileContent.includes('Remove'), 'Must provide Remove action')
  })

  it('5. Motion prompt card features character counter, inspiration presets, and negative prompt', () => {
    assert.ok(fileContent.includes('motionPrompt.length'), 'Must display character counter')
    assert.ok(fileContent.includes('Preset Motion Themes'), 'Must display motion themes presets')
    assert.ok(fileContent.includes('Negative Prompt'), 'Must include negative prompt accordion')
    assert.ok(fileContent.includes('Enhance Prompt'), 'Must include enhance prompt button')
  })

  it('6. Video Preview Canvas features 16:9 placeholder, displays starting keyframe when uploaded, and honest empty state', () => {
    assert.ok(fileContent.includes('aspect-video'), 'Video canvas must enforce 16:9 aspect-video')
    assert.ok(fileContent.includes('Keyframe 0 (Starting Frame)'), 'Must badge uploaded image as starting frame')
    assert.ok(fileContent.includes('Your generated video will appear here'), 'Must show canvas ready headline when empty')
    assert.ok(fileContent.includes('Spatio-Temporal 3D DiT Video Engine'), 'Must include video engine badge')
    assert.ok(fileContent.includes('In Development (Demo Mode)'), 'Must indicate In Development status')
  })

  it('7. Row 2 features open-weights models, all marked "Coming Soon"', () => {
    assert.ok(fileContent.includes('wan-2.1-i2v-14b'), 'Must include Wan 2.1 I2V 14B Cinema')
    assert.ok(fileContent.includes('wan-2.1-i2v-1.3b'), 'Must include Wan 2.1 I2V 1.3B Turbo')
    assert.ok(fileContent.includes('Commercial Apache 2.0 Weights'), 'Must display open weights notice')
  })

  it('8. Video Settings card matches height and styling of second-row controls', () => {
    assert.ok(fileContent.includes('Video Specifications & Dynamics'), 'Settings card title')
    assert.ok(fileContent.includes('Duration'), 'Duration control')
    assert.ok(fileContent.includes('Resolution'), 'Resolution control')
    assert.ok(fileContent.includes('Motion Intensity'), 'Motion Intensity control')
    assert.ok(fileContent.includes('Camera Motion'), 'Camera motion control')
    assert.ok(fileContent.includes('h-[108px] sm:h-[112px]'), 'Must match 108px-112px card row height')
  })

  it('9. Generate Button is centered, disabled, and indicates "Coming Soon"', () => {
    assert.ok(fileContent.includes('Video Generation Coming Soon'), 'Button text must indicate Coming Soon')
    assert.ok(fileContent.includes('disabled={true}'), 'Button must be explicitly disabled')
    assert.ok(fileContent.includes('opacity-60 cursor-not-allowed'), 'Button must have disabled cursor and styling')
  })

  it('10. No fake generation simulations, fake intervals, or fake sample videos', () => {
    assert.strictEqual(fileContent.includes('INITIAL_I2V_GALLERY'), false, 'Fake INITIAL_I2V_GALLERY must be removed')
    assert.strictEqual(fileContent.includes('setPlayerProgress'), false, 'Fake player interval loop must be removed')
    assert.strictEqual(fileContent.includes('api.post(\'/generation/jobs\''), false, 'Must not post non-existent video jobs')
  })

  it('11. Recent Generations connects to authenticated assets API with honest empty state', () => {
    assert.ok(fileContent.includes('/assets/generations'), 'Must fetch real generations from assets API')
    assert.ok(fileContent.includes('IMAGE_TO_VIDEO'), 'Must filter by IMAGE_TO_VIDEO generationType')
    assert.ok(fileContent.includes('Your recent video animations will appear here'), 'Must provide clean empty state')
    assert.ok(fileContent.includes('grid-cols-2 sm:grid-cols-3 md:grid-cols-6'), 'Must match 6-column gallery layout')
  })
})
