import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assetIdIsValid, assetName, decodeRgba, imageError, imageFormat, normalizedSize } from './assets.mjs';

const PROJECT_FORMAT = 'charcoal-project';
const VERSION = 1;
const MiB = 1024 * 1024;
const MAX_PROJECT_BYTES = 160 * MiB;
const MAX_BLOB_BYTES = 94 * MiB;
const HASH = /^[a-f\d]{64}$/;
const INVALID_BASE64 = /[^A-Za-z0-9+/=]/;
const IMAGE_EXTENSIONS = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/tiff': ['.tiff', '.tif'],
  'image/heic': ['.heic', '.heif'],
  'image/avif': ['.avif'],
};
const IMAGE_SUFFIXES = new Set(Object.values(IMAGE_EXTENSIONS).flat());

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function publicAsset({ id, name, width, height }) {
  const url = '/api/assets/' + id;
  return { id, name, width, height, url, originalUrl: url + '/original' };
}

function originalDownloadName({ name, mime }) {
  const extensions = IMAGE_EXTENSIONS[mime];
  const suffix = extname(name).toLowerCase();
  if (!extensions || extensions.includes(suffix)) return name;
  const base = IMAGE_SUFFIXES.has(suffix) ? name.slice(0, -suffix.length) : name;
  return base + extensions[0];
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeBlob(directory, hash, bytes) {
  const path = join(directory, hash);
  if (existsSync(path)) return;
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function validateBundle(bundle) {
  if (!isObject(bundle) || bundle.format !== PROJECT_FORMAT || bundle.version !== VERSION ||
      (bundle.workspace !== null && !isObject(bundle.workspace)) ||
      !Array.isArray(bundle.runs) || !Array.isArray(bundle.assets) || !isObject(bundle.blobs)) {
    throw imageError('Choose a Charcoal project bundle.');
  }
  const assets = new Set();
  const hashes = new Set();
  for (const asset of bundle.assets) {
    if (!isObject(asset) || !assetIdIsValid(asset.id) || assets.has(asset.id) ||
        typeof asset.name !== 'string' || asset.name !== assetName(asset.name) ||
        typeof asset.originalHash !== 'string' || !HASH.test(asset.originalHash) ||
        typeof asset.normalizedHash !== 'string' || !HASH.test(asset.normalizedHash)) {
      throw imageError('The project contains invalid asset details.');
    }
    assets.add(asset.id);
    hashes.add(asset.originalHash);
    hashes.add(asset.normalizedHash);
  }
  let total = 0;
  const blobs = new Map();
  for (const hash of hashes) {
    const encoded = bundle.blobs[hash];
    if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(MAX_BLOB_BYTES / 3) * 4 ||
        encoded.length % 4 || INVALID_BASE64.test(encoded) ||
        encoded.slice(0, -2).includes('=') || encoded.slice(-2, -1) === '=' && !encoded.endsWith('=')) {
      throw imageError('The project contains invalid or missing image data.');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (sha256(bytes) !== hash) throw imageError('An image in the project is damaged.');
    total += bytes.length;
    if (total > MAX_PROJECT_BYTES) throw imageError('The project bundle exceeds 160 MiB of image data.', 413);
    blobs.set(hash, bytes);
  }
  return blobs;
}

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const imageDir = join(dataDir, 'images');
  mkdirSync(imageDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'charcoal.sqlite'));
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > VERSION) throw new Error('This datastore requires a newer version of Charcoal.');
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        mime TEXT NOT NULL,
        originalHash TEXT NOT NULL,
        normalizedHash TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const statements = {
    get: db.prepare('SELECT value FROM state WHERE key = ?'),
    set: db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    getAsset: db.prepare('SELECT * FROM assets WHERE id = ?'),
    renameAsset: db.prepare('UPDATE assets SET name = ? WHERE id = ? RETURNING id, name, width, height'),
    listAssets: db.prepare('SELECT * FROM assets ORDER BY rowid'),
    insertAsset: db.prepare(`
      INSERT INTO assets (id, name, width, height, mime, originalHash, normalizedHash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `),
  };

  function get(key, fallback) {
    const row = statements.get.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  function set(key, value) {
    statements.set.run(key, JSON.stringify(value));
  }

  function insertAsset({ id, name, width, height, mime, originalHash, normalizedHash }) {
    statements.insertAsset.run(id, name, width, height, mime, originalHash, normalizedHash);
  }

  function putAsset(asset, { original, normalized, mime }) {
    if (!assetIdIsValid(asset.id)) throw imageError('Invalid asset ID.');
    const originalHash = sha256(original);
    const normalizedHash = sha256(normalized);
    writeBlob(imageDir, originalHash, original);
    writeBlob(imageDir, normalizedHash, normalized);
    syncDirectory(imageDir);
    insertAsset({ ...asset, mime, originalHash, normalizedHash });
    const saved = statements.getAsset.get(asset.id);
    if (saved.originalHash !== originalHash || saved.normalizedHash !== normalizedHash) {
      throw imageError('An image with this ID already exists.', 409);
    }
    return publicAsset(saved);
  }

  function getAsset(id) {
    const row = assetIdIsValid(id) && statements.getAsset.get(id);
    return row ? publicAsset(row) : undefined;
  }

  function renameAsset(id, name) {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value || !value.isWellFormed() || value !== assetName(value)) {
      throw imageError('Use 1 to 180 characters without slashes or control characters.');
    }
    const row = assetIdIsValid(id) && statements.renameAsset.get(value, id);
    if (!row) throw imageError('Image not found.', 404);
    return publicAsset(row);
  }

  function readAsset(id, variant = 'normalized') {
    const asset = assetIdIsValid(id) && statements.getAsset.get(id);
    if (!asset) return undefined;
    if (variant === 'original') {
      return { bytes: readFileSync(join(imageDir, asset.originalHash)), mime: asset.mime, name: originalDownloadName(asset) };
    }
    if (variant !== 'normalized') throw imageError('Unknown image variant.');
    const pngName = (asset.name.replace(/\.[^.]+$/, '') || asset.name) + '.png';
    return { bytes: readFileSync(join(imageDir, asset.normalizedHash)), mime: 'image/png', name: pngName };
  }

  function exportProject() {
    const assets = statements.listAssets.all().map(asset => ({ ...asset }));
    const hashes = new Set(assets.flatMap(asset => [asset.originalHash, asset.normalizedHash]));
    const blobs = {};
    let total = 0;
    for (const hash of hashes) {
      const bytes = readFileSync(join(imageDir, hash));
      total += bytes.length;
      if (total > MAX_PROJECT_BYTES) throw imageError('The project bundle exceeds 160 MiB of image data.', 413);
      blobs[hash] = bytes.toString('base64');
    }
    return { format: PROJECT_FORMAT, version: VERSION, workspace: get('workspace', null), runs: get('runs', []), assets, blobs };
  }

  async function importProject(bundle, { validate } = {}) {
    const blobs = validateBundle(bundle);
    const checked = new Set();
    for (const asset of bundle.assets) {
      const normalized = blobs.get(asset.normalizedHash);
      const { width, height } = normalizedSize(normalized);
      const { mime } = imageFormat(blobs.get(asset.originalHash));
      if (width !== asset.width || height !== asset.height || mime !== asset.mime) {
        throw imageError('An image does not match its project metadata.');
      }
      if (!checked.has(asset.normalizedHash)) {
        await decodeRgba(normalized);
        checked.add(asset.normalizedHash);
      }
    }
    await validate?.({ workspace: bundle.workspace, runs: bundle.runs, assets: bundle.assets.map(publicAsset) });
    for (const [hash, bytes] of blobs) writeBlob(imageDir, hash, bytes);
    syncDirectory(imageDir);

    // Files are immutable. New records become visible only once every referenced blob is durable.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM assets');
      for (const asset of bundle.assets) insertAsset(asset);
      set('workspace', bundle.workspace);
      set('runs', bundle.runs);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { workspace: bundle.workspace, runs: bundle.runs, assets: bundle.assets.map(publicAsset) };
  }

  return {
    get, set, getAsset, putAsset, renameAsset, readAsset, exportProject, importProject,
    listAssets: () => statements.listAssets.all().map(publicAsset),
    close: () => db.close(),
  };
}
