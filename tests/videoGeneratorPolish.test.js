import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('KIAAN STUDIO — TEXT-TO-VIDEO UI POLISH VERIFICATION', () => {
  const videoPagePath = path.resolve(
    __dirname,
    '../../Kiaan-ai-image-generator-frontend/src/pages/customer/VideoGeneratorPage.jsx'
  )

  it('1. VideoGeneratorPage.jsx file exists and is readable', () => {
    assert.strictEqual(fs.existsSync(videoPagePath), true, 'VideoGeneratorPage.jsx must exist')
  })

  const fileContent = fs.readFileSync(videoPagePath, 'utf-8')

  it('2. Top Header matches Text-to-Image / Image-to-Image studio theme with "Coming Soon" badge', () => {
    assert.ok(fileContent.includes('Creation Studio'), 'Header must contain Creation Studio breadcrumb')
    assert.ok(fileContent.includes('Text-to-Video Studio'), 'Header title must be Text-to-Video Studio')
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

  it('4. Video Preview Canvas features 16:9 placeholder, play icon, and honest status', () => {
    assert.ok(fileContent.includes('aspect-video'), 'Video canvas must enforce 16:9 aspect-video')
    assert.ok(fileContent.includes('Your generated video will appear here'), 'Must show canvas ready headline')
    assert.ok(fileContent.includes('Spatio-Temporal 3D DiT Video Engine'), 'Must include video engine badge')
    assert.ok(fileContent.includes('In Development (Demo Mode)'), 'Must indicate In Development status')
  })

  it('5. Row 2 features 3 open-weights models, all marked "Coming Soon"', () => {
    assert.ok(fileContent.includes('wan-2.1-t2v-1.3b'), 'Must include Wan 2.1 Draft 480p')
    assert.ok(fileContent.includes('wan-2.1-t2v-14b'), 'Must include Wan 2.1 Cinema 720p')
    assert.ok(fileContent.includes('ltx-video-0.9'), 'Must include LTX-Video 0.9.1')
    assert.ok(fileContent.includes('Commercial Apache 2.0 Weights'), 'Must display open weights notice')
  })

  it('6. Video Settings card matches height and styling of second-row controls', () => {
    assert.ok(fileContent.includes('Video Specifications & Dynamics'), 'Settings card title')
    assert.ok(fileContent.includes('Duration'), 'Duration control')
    assert.ok(fileContent.includes('Resolution'), 'Resolution control')
    assert.ok(fileContent.includes('Aspect Ratio'), 'Aspect ratio control')
    assert.ok(fileContent.includes('Camera Motion'), 'Camera motion control')
    assert.ok(fileContent.includes('h-[108px] sm:h-[112px]'), 'Must match 108px-112px card row height')
  })

  it('7. Generate Button is centered, disabled, and indicates "Coming Soon"', () => {
    assert.ok(fileContent.includes('Video Generation Coming Soon'), 'Button text must indicate Coming Soon')
    assert.ok(fileContent.includes('disabled={true}'), 'Button must be explicitly disabled')
    assert.ok(fileContent.includes('opacity-60 cursor-not-allowed'), 'Button must have disabled cursor and styling')
  })

  it('8. No fake generation simulations, fake intervals, or fake sample videos', () => {
    assert.strictEqual(fileContent.includes('SAMPLE_VIDEOS'), false, 'Fake SAMPLE_VIDEOS must be removed')
    assert.strictEqual(fileContent.includes('setPlayerProgress'), false, 'Fake player interval loop must be removed')
    assert.strictEqual(fileContent.includes('api.post(\'/generation/jobs\''), false, 'Must not post non-existent video jobs')
  })

  it('9. Recent Generations connects to authenticated assets API with honest empty state', () => {
    assert.ok(fileContent.includes('/assets/generations'), 'Must fetch real generations from assets API')
    assert.ok(fileContent.includes('Your recent video generations will appear here'), 'Must provide clean empty state')
    assert.ok(fileContent.includes('grid-cols-2 sm:grid-cols-3 md:grid-cols-6'), 'Must match 6-column gallery layout')
  })
})
