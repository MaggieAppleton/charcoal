import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

const MiB = 1024 * 1024;
const MAX_EDGE = 10_000;
const MAX_PIXELS = 24_000_000;
const MAX_PNG_BYTES = MAX_PIXELS * 4 + 2 * MiB;
export const MAX_ASSET_BYTES = 50 * MiB;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const srgbProfile = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
const convertProfile = existsSync(srgbProfile) ? ['-profile', srgbProfile] : [];

export function imageError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function assetIdIsValid(id) {
  return typeof id === 'string' && /^[a-z\d][a-z\d_-]{0,79}$/i.test(id);
}

export function assetName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180) || 'Untitled image';
}

export function checkImageSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw imageError('Use an image under 24 megapixels and at most 10,000 pixels on each side.', 413);
  }
  return { width, height };
}

export function imageFormat(bytes) {
  if (!Buffer.isBuffer(bytes)) throw imageError('Image data is missing.');
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { coder: 'png', mime: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { coder: 'jpeg', mime: 'image/jpeg' };
  }
  const header = bytes.toString('latin1', 0, 12);
  if (/^GIF8[79]a/.test(header)) return { coder: 'gif', mime: 'image/gif' };
  if (header.startsWith('RIFF') && header.endsWith('WEBP')) return { coder: 'webp', mime: 'image/webp' };
  if (header.startsWith('II*\0') || header.startsWith('MM\0*')) return { coder: 'tiff', mime: 'image/tiff' };
  if (header.slice(4, 8) === 'ftyp' && bytes.length >= 16) {
    const brands = [header.slice(8, 12)];
    const end = Math.min(bytes.length, bytes.readUInt32BE(0), 64);
    for (let offset = 16; offset + 4 <= end; offset += 4) {
      brands.push(bytes.toString('ascii', offset, offset + 4));
    }
    if (brands.some(brand => AVIF_BRANDS.has(brand))) return { coder: 'heic', mime: 'image/avif' };
    if (brands.some(brand => HEIC_BRANDS.has(brand))) return { coder: 'heic', mime: 'image/heic' };
  }
  throw imageError('Choose a PNG, JPEG, WebP, GIF, TIFF, HEIC or AVIF image.');
}

export function normalizedSize(bytes) {
  if (bytes.length < 33 || bytes.length > MAX_PNG_BYTES ||
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes[24] !== 8 || bytes[25] !== 6) {
    throw imageError('The normalized image must be an RGBA PNG.');
  }
  return checkImageSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

const limits = [
  '-limit', 'width', String(MAX_EDGE), '-limit', 'height', String(MAX_EDGE),
  '-limit', 'memory', '512MiB', '-limit', 'map', '0', '-limit', 'disk', '0',
  '-limit', 'thread', '2', '-limit', 'list-length', '8',
];

function magick(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('magick', args, {
      encoding: 'buffer', maxBuffer: MAX_PNG_BYTES, timeout: 25_000,
    }, (error, stdout) => {
      if (!error) resolve(stdout);
      else if (error.code === 'ENOENT') reject(imageError('Install ImageMagick to read and write images.', 503));
      else reject(imageError('Could not read or write this image. Try exporting it as a PNG.'));
    });
    child.stdin.on('error', () => { /* execFile reports conversion failures. */ });
    child.stdin.end(input);
  });
}

async function normalize(bytes, coder) {
  const input = coder + ':-[0]';
  const dimensions = await magick(['identify', ...limits, '-ping', '-format', '%w %h', input], bytes);
  checkImageSize(...dimensions.toString('ascii').trim().split(' ').map(Number));
  return magick([
    ...limits, '-regard-warnings', input, '-auto-orient', '+repage',
    ...convertProfile,
    '-colorspace', 'sRGB', '-strip', '-alpha', 'on', '-depth', '8', 'PNG32:-',
  ], bytes);
}

export async function decodeRgba(pngBytes) {
  if (!Buffer.isBuffer(pngBytes) || pngBytes.length < 33 || pngBytes.length > MAX_PNG_BYTES ||
      !pngBytes.subarray(0, 8).equals(PNG_SIGNATURE) || pngBytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw imageError('The image must be a PNG.');
  }
  const { width, height } = checkImageSize(pngBytes.readUInt32BE(16), pngBytes.readUInt32BE(20));
  const data = await magick([...limits, '-regard-warnings', 'png:-[0]', '-alpha', 'on', '-depth', '8', 'rgba:-'], pngBytes);
  if (data.length !== width * height * 4) throw imageError('The image pixels do not match its dimensions.');
  return { data, width, height };
}

export async function encodeRgba(data, width, height) {
  checkImageSize(width, height);
  if (!(data instanceof Uint8Array) || data.length !== width * height * 4) {
    throw imageError('The image pixels do not match its dimensions.');
  }
  return magick([
    ...limits, '-size', width + 'x' + height, '-depth', '8', 'rgba:-', '-alpha', 'on', '-strip', 'PNG32:-',
  ], data);
}

export async function importAsset(store, { name, bytes }, { id = randomUUID(), normalized = false } = {}) {
  if (!assetIdIsValid(id)) throw imageError('Invalid asset ID.');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw imageError('Image data is missing.');
  if (bytes.byteLength > (normalized ? MAX_PNG_BYTES : MAX_ASSET_BYTES)) {
    throw imageError('Use an original image under 50 MiB.', 413);
  }
  const original = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { coder, mime } = imageFormat(original);
  const png = normalized ? original : await normalize(original, coder);
  const { width, height } = normalizedSize(png);
  if (normalized) await decodeRgba(png);
  return store.putAsset({ id, name: assetName(name), width, height }, { original, normalized: png, mime });
}

export function readAsset(store, id, variant = 'normalized') {
  return store.readAsset(id, variant);
}
