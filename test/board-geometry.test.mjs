import assert from 'node:assert/strict';
import test from 'node:test';
import { imageRects, placeImages, toScreen, toWorld, zoomAt } from '../src/board-geometry.ts';

test('zoom keeps the world point under the pointer at either zoom limit', () => {
  const camera = { x: -100, y: 240, zoom: 2 };
  const point = { x: 370, y: 408 };
  const from = toWorld(point, camera);
  for (const zoom of [.001, .5, 2, 10]) {
    const next = toWorld(point, zoomAt(camera, point, zoom));
    assert.ok(Math.abs(next.x - from.x) < 1e-8);
    assert.ok(Math.abs(next.y - from.y) < 1e-8);
  }
  assert.deepEqual(toScreen({ ...from, width: 40, height: 20 }, camera),
    { ...point, width: 80, height: 40 });
});

test('introductory artwork matches the desktop and narrow composition', () => {
  const items = [
    { id: 'layout', seedGroup: 'A', shape: 'tall' },
    { id: 'swatches', seedGroup: 'A', shape: 'square' },
    { id: 'walkers', seedGroup: 'B' },
    { id: 'leaves', seedGroup: 'B' },
    { id: 'grain', seedGroup: 'B', shape: 'tall' },
    ...Array.from({ length: 4 }, (_, index) => ({ id: 's' + index, seedGroup: 'Stream' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: 'h' + index, seedGroup: 'Hill' })),
  ];
  const wide = imageRects(items, {}, 1408);
  assert.deepEqual({ ...wide.s0, x: Math.round(wide.s0.x * 10) / 10 }, { x: 531.2, y: 72, width: 176, height: 99 });
  assert.deepEqual(wide.h0, { ...wide.s0, y: 215 });
  assert.ok(Math.abs(wide.layout.x - 154.8) < 1e-8);
  assert.ok(Math.abs(wide.layout.width - 123.2) < 1e-8);
  const narrow = imageRects(items, { s0: wide.s0 }, 358);
  assert.deepEqual(narrow.s0, wide.s0);
  assert.equal(narrow.layout.x, 16);
  assert.equal(narrow.layout.y, 60);
  assert.equal(narrow.walkers.x, 184);
  assert.equal(narrow.s3.x, 16);
  assert.ok(narrow.s3.y > narrow.s2.y);
  assert.ok(narrow.h0.y > narrow.s3.y);
});

test('batch placement keeps aspect ratios, wraps and clears occupied rectangles', () => {
  const rects = placeImages([
    { id: 'portrait', width: 200, height: 400 },
    { id: 'square', width: 200, height: 200 },
    { id: 'wide', width: 1000, height: 100 },
    { id: 'last', width: 500, height: 800 },
  ], { x: 100, y: 60 }, [{ x: 70, y: 50.005, width: 110, height: 84.019 }]);
  assert.ok(rects.portrait.y >= 50.005 + 84.019 + 12);
  assert.equal(rects.portrait.width / rects.portrait.height, .5);
  assert.ok(Math.abs(rects.wide.width / rects.wide.height - 10) < 1e-8);
  assert.equal(rects.last.x, 100);
  assert.ok(rects.last.y >= rects.portrait.y + rects.portrait.height + 12);
});
