import {spawn} from 'node:child_process'
import {decodeRgba, encodeRgba} from './assets.mjs'

export function isFocalArea(area) {
  return Array.isArray(area) && area.length === 4 &&
    area.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    area[2] > 0 && area[3] > 0 &&
    area[0] + area[2] <= 1.0000001 && area[1] + area[3] <= 1.0000001
}

export function fitGeometry(width, height, outWidth, outHeight) {
  const scale = Math.min(outWidth / width, outHeight / height)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return {w, h, x: Math.floor((outWidth - w) / 2), y: Math.floor((outHeight - h) / 2)}
}

export function transformPng(bytes, args) {
  return new Promise((resolve, reject) => {
    const magick = spawn('magick', ['-limit', 'memory', '256MiB', '-limit', 'map', '512MiB',
      '-limit', 'disk', '0', '-limit', 'thread', '2', '-limit', 'list-length', '8',
      'png:-[0]', ...args, '-depth', '8', 'PNG32:-'], {stdio:['pipe','pipe','pipe'], timeout:45000})
    const chunks = []
    let size = 0
    magick.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size <= 104857600) chunks.push(chunk)
      else magick.kill()
    })
    magick.stderr.resume()
    magick.stdin.on('error', () => {})
    magick.on('error', reject)
    magick.on('close', (code) => {
      if (code !== 0) reject(new Error('The image could not be mapped to the requested canvas.'))
      else resolve(Buffer.concat(chunks))
    })
    magick.stdin.end(bytes)
  })
}

function pad(bytes, geometry, width, height, background) {
  const {w,h,x,y} = geometry
  return transformPng(bytes, ['-resize', `${w}x${h}!`, '-background', background,
    '-gravity', 'NorthWest', '-extent', `${width}x${height}-${x}-${y}`])
}

function hasContent(pixels) {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true
  return false
}

export async function prepareRegional(target, region, mode, width, height) {
  const source = await decodeRgba(target)
  const guide = await decodeRgba(region)
  if (source.width !== guide.width || source.height !== guide.height) {
    throw new Error('The guide dimensions differ from the source. Reopen the edit area and try again.')
  }
  const empty = new Error(mode === 'mask' ? 'The edit area is empty. Paint a region or choose Whole image.'
    : 'The sketch is empty. Draw a guide or choose Whole image.')
  if (!hasContent(guide.data)) throw empty
  const geometry = fitGeometry(source.width, source.height, width, height)
  const first = await pad(target, geometry, width, height, '#ecebe6')
  const padded = await pad(region, geometry, width, height, 'none')
  const image = await decodeRgba(padded)
  if (!hasContent(image.data)) throw new Error('The guide is too small at the requested size. Use a larger brush or image size.')
  if (mode === 'markup') return {first, guide:padded, geometry, source, width, height}
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3]
    image.data.fill(255, i, i + 3)
    image.data[i + 3] = alpha > 0 ? 0 : 255
  }
  return {first, guide:await encodeRgba(image.data,width,height), geometry, source, width, height, mask:guide.data}
}

export async function unframe(raw, edit, protect) {
  const got = await decodeRgba(raw)
  if (got.width !== edit.width || got.height !== edit.height) {
    throw new Error('Sunburst returned a different image size. Retry using the same size or start a whole-image edit.')
  }
  const {w,h,x,y} = edit.geometry
  const {source} = edit
  const mapped = await transformPng(raw, ['-crop', `${w}x${h}+${x}+${y}`, '+repage',
    '-resize', `${source.width}x${source.height}!`])
  if (!protect) return {bytes:mapped}
  const {data} = await decodeRgba(mapped)
  const output = Buffer.from(source.data)
  let changedArea = 0
  for (let i = 0; i < output.length; i += 4) {
    if (edit.mask[i + 3] === 0) continue
    data.copy(output, i, i, i + 4)
    changedArea++
  }
  if (!changedArea) throw new Error('The edit area is empty. Paint a region or choose Whole image.')
  const bytes = await encodeRgba(output,source.width,source.height)
  const verified = await decodeRgba(bytes)
  for (let i = 0; i < output.length; i += 4) {
    if (!edit.mask[i + 3] && verified.data.readUInt32LE(i) !== source.data.readUInt32LE(i)) {
      throw new Error('Protected pixels could not be preserved. The raw response is saved in the run.')
    }
  }
  return {bytes, exactPixels:source.width * source.height - changedArea}
}
