import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeRgba, encodeRgba, importAsset, readAsset } from '../server/assets.mjs';
import { openStore } from '../server/store.mjs';

function temporaryData(t) {
  const dir = mkdtempSync(join(tmpdir(), 'charcoal-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('reopening restores workspace state and keeps exact original bytes', async (t) => {
  const dir = temporaryData(t);
  const pixels = Buffer.from([31, 42, 53, 0, 81, 68, 102, 129]);
  const bytes = await encodeRgba(pixels, 2, 1);
  const store = openStore(dir);
  const asset = await importAsset(store, { bytes, name: 'Reference.png' }, { id: 'fixture' });
  store.set('workspace', { selected: [asset.id] });
  store.close();

  const reopened = openStore(dir);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get('workspace'), { selected: ['fixture'] });
  assert.deepEqual(reopened.listAssets(), [asset]);
  assert.deepEqual(readAsset(reopened, 'fixture', 'original').bytes, bytes);
  assert.deepEqual(await decodeRgba(readAsset(reopened, 'fixture').bytes), {
    data: pixels, width: 2, height: 1,
  });
});

test('renaming an image changes only its saved name', async (t) => {
  const dir = temporaryData(t);
  const pixels = Buffer.from([31, 42, 53, 0, 81, 68, 102, 129]);
  const bytes = await encodeRgba(pixels, 2, 1);
  const store = openStore(dir);
  const asset = await importAsset(store, { bytes, name: 'Reference.png' }, { id: 'fixture' });
  const workspace = { imageIds: [asset.id], referenceIds: [asset.id], positions: { [asset.id]: { x: 16, y: 24 } } };
  const runs = [{ id: 'history', prompt: 'Use image 1, Reference.png.' }];
  store.set('workspace', workspace);
  store.set('runs', runs);
  const before = store.exportProject();
  assert.throws(() => store.renameAsset(asset.id, '   '), { status: 400 });
  assert.throws(() => store.renameAsset(asset.id, 'A/name'), { status: 400 });
  assert.throws(() => store.renameAsset('missing', 'New name'), { status: 404 });
  assert.deepEqual(store.renameAsset(asset.id, '  Illustration study.png  '), { ...asset, name: 'Illustration study.png' });
  store.close();

  const reopened = openStore(dir);
  t.after(() => reopened.close());
  const after = reopened.exportProject();
  assert.deepEqual(after, { ...before, assets: [{ ...before.assets[0], name: 'Illustration study.png' }] });
});

test('original download uses the validated image extension after renaming', async (t) => {
  const store = openStore(temporaryData(t));
  t.after(() => store.close());
  const bytes = await encodeRgba(Buffer.from([12, 34, 56, 78]), 1, 1);
  const asset = await importAsset(store, { bytes, name: 'Drawing.PNG' });
  assert.equal(readAsset(store, asset.id, 'original').name, 'Drawing.PNG');
  for (const [label, expected] of [['Chart.jpg', 'Chart.png'], ['Chart.v2', 'Chart.v2.png']]) {
    store.renameAsset(asset.id, label);
    assert.equal(store.getAsset(asset.id).name, label);
    assert.deepEqual(readAsset(store, asset.id, 'original'), { bytes, mime: 'image/png', name: expected });
  }
});

test('import applies EXIF orientation to the normalized image', async (t) => {
  const bytes = execFileSync('magick', ['-size', '20x10', 'xc:red', '-colorspace', 'sRGB', 'jpeg:-']);
  const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  const rotatedJpeg = Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)]);
  const store = openStore(temporaryData(t));
  t.after(() => store.close());
  const asset = await importAsset(store, { name: 'portrait.jpg', bytes: rotatedJpeg });
  assert.equal(asset.width, 10);
  assert.equal(asset.height, 20);
  assert.deepEqual(readAsset(store, asset.id, 'original').bytes, rotatedJpeg);
});

test('reopening a bundle restores run snapshots and files to a clean store', async (t) => {
  const source = openStore(temporaryData(t));
  const copy = openStore(temporaryData(t));
  t.after(() => source.close());
  t.after(() => copy.close());
  const bytes = await encodeRgba(Buffer.from([12, 34, 56, 78]), 1, 1);
  const asset = await importAsset(source, { bytes, name: 'Candidate.png' }, { normalized: true });
  source.set('workspace', { selected: [asset.id] });
  source.set('runs', [{ id: 'run-1', outputs: [asset.id] }]);
  copy.set('workspace', { selected: ['old'] });

  await copy.importProject(JSON.parse(JSON.stringify(source.exportProject())));
  assert.deepEqual(copy.get('workspace'), { selected: [asset.id] });
  assert.deepEqual(copy.get('runs'), [{ id: 'run-1', outputs: [asset.id] }]);
  assert.deepEqual(copy.listAssets(), [asset]);
  assert.deepEqual(readAsset(copy, asset.id).bytes, bytes);
});

test('an invalid bundle leaves the active project intact', async (t) => {
  const store = openStore(temporaryData(t));
  t.after(() => store.close());
  const bytes = await encodeRgba(Buffer.from([0, 0, 0, 255]), 1, 1);
  const asset = await importAsset(store, { bytes, name: 'Keep.png' });
  store.set('workspace', { selected: [asset.id] });
  const bundle = store.exportProject();
  bundle.workspace = { selected: [] };
  bundle.assets[0].id = '../invalid';
  await assert.rejects(store.importProject(bundle), /asset/i);
  assert.deepEqual(store.get('workspace'), { selected: [asset.id] });
  assert.deepEqual(store.listAssets(), [asset]);
});

test('input format is detected from bytes instead of the supplied name', async (t) => {
  const store = openStore(temporaryData(t));
  t.after(() => store.close());
  await assert.rejects(importAsset(store, {
    name: 'not-a-png.png',
    bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  }), /image/i);
  assert.deepEqual(store.listAssets(), []);
});

test('project import accepts a multi-megabyte image', async (t) => {
  const source = openStore(temporaryData(t));
  const copy = openStore(temporaryData(t));
  t.after(() => source.close());
  t.after(() => copy.close());
  const pixels = randomBytes(1600 * 1200 * 4);
  const bytes = await encodeRgba(pixels, 1600, 1200);
  const asset = await importAsset(source, { bytes, name: 'Large.png' }, { normalized: true });
  await copy.importProject(source.exportProject());
  assert.deepEqual(readAsset(copy, asset.id).bytes, bytes);
});
