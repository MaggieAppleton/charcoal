import type { BoardImage, BoardMark, Point, Rect } from './board-geometry.js';
import { between, distance } from './board-geometry.js';

const INK = '#1d1c1a';
const PAPER = '#f7f6f2';
const NOTE_WIDTH = 156;
const NOTE_HEIGHT = 120;

function arrowHead(from: Point, to: Point): Point[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.min(13, distance(from, to) / 2);
  const wing = (offset: number) => ({
    x: to.x - length * Math.cos(angle + offset),
    y: to.y - length * Math.sin(angle + offset),
  });
  return [wing(.52), to, wing(-.52)];
}

function pointString(points: Point[]) {
  return points.map(point => `${point.x},${point.y}`).join(' ');
}

export function markRect(mark: BoardMark): Rect {
  const [start] = mark.points;
  if (mark.kind === 'note') return { ...start, width: NOTE_WIDTH, height: NOTE_HEIGHT };
  const line = mark.kind === 'arrow' ? [...mark.points, ...arrowHead(start, mark.points.at(-1)!)] : mark.points;
  let minX = start.x, minY = start.y, maxX = start.x, maxY = start.y;
  for (const { x, y } of line) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX - 3, y: minY - 3, width: maxX - minX + 6, height: maxY - minY + 6 };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  return {
    x, y,
    width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rects.map(rect => rect.y + rect.height)) - y,
  };
}

function segmentDistance(point: Point, a: Point, b: Point) {
  const x = b.x - a.x, y = b.y - a.y, length2 = x * x + y * y;
  if (!length2) return distance(point, a);
  const progress = Math.max(0, Math.min(1, ((point.x - a.x) * x + (point.y - a.y) * y) / length2));
  return distance(point, { x: a.x + progress * x, y: a.y + progress * y });
}

export function hitMark(mark: BoardMark, point: Point, tolerance: number): boolean {
  const bounds = markRect(mark);
  if (point.x < bounds.x - tolerance || point.x > bounds.x + bounds.width + tolerance ||
      point.y < bounds.y - tolerance || point.y > bounds.y + bounds.height + tolerance) return false;
  const [start] = mark.points, end = mark.points.at(-1)!;
  if (mark.kind === 'note') return true;
  if (mark.kind === 'ellipse') {
    const { x, y, width, height } = between(start, end);
    if (!width || !height) return segmentDistance(point, start, end) <= tolerance;
    const nx = (point.x - x - width / 2) / (width / 2);
    const ny = (point.y - y - height / 2) / (height / 2);
    return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(width, height) / 2 <= tolerance;
  }
  let line = mark.points;
  if (mark.kind === 'arrow') line = [start, end, ...arrowHead(start, end)];
  if (mark.kind === 'rect') {
    line = [start, { x: start.x, y: end.y }, end, { x: end.x, y: start.y }, start];
  }
  return line.some((b, index) => segmentDistance(point, line[index - 1] ?? b, b) <= tolerance);
}

export function BoardMarkArt({ mark }: { mark: BoardMark }) {
  const [start] = mark.points, end = mark.points.at(-1)!;
  if (mark.kind === 'note') return null;
  if (mark.kind === 'pen') {
    if (mark.points.length === 1) return <circle cx={start.x} cy={start.y} r={1.5} fill="currentColor" />;
    return <polyline points={pointString(mark.points)} />;
  }
  if (mark.kind === 'arrow') {
    return <g><polyline points={pointString([start, end])} /><polyline points={pointString(arrowHead(start, end))} /></g>;
  }
  const { x, y, width, height } = between(start, end);
  if (mark.kind === 'rect') return <rect x={x} y={y} width={width} height={height} />;
  return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
}

function drawNote(ctx: CanvasRenderingContext2D, mark: BoardMark) {
  const { x, y, width, height } = markRect(mark);
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';
  ctx.font = '14px system-ui, sans-serif';
  let top = y + 8;
  for (const paragraph of (mark.text ?? '').split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > width - 16) {
        ctx.fillText(line, x + 8, top);
        line = '';
        top += 20;
      }
      line += char;
    }
    ctx.fillText(line, x + 8, top);
    top += 20;
  }
  ctx.restore();
}

function drawMark(ctx: CanvasRenderingContext2D, mark: BoardMark) {
  if (mark.kind === 'note') return drawNote(ctx, mark);
  const [start] = mark.points, end = mark.points.at(-1)!;
  ctx.beginPath();
  if (mark.kind === 'ellipse') {
    const { x, y, width, height } = between(start, end);
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
  } else if (mark.kind === 'rect') {
    const { x, y, width, height } = between(start, end);
    ctx.rect(x, y, width, height);
  } else {
    ctx.moveTo(start.x, start.y);
    for (const point of mark.points) ctx.lineTo(point.x, point.y);
    if (mark.kind === 'arrow') {
      const [a, tip, b] = arrowHead(start, end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(b.x, b.y);
    } else if (mark.points.length === 1) {
      ctx.lineTo(start.x + .01, start.y);
    }
  }
  ctx.stroke();
}

export async function flattenReference(
  images: BoardImage[], rects: Record<string, Rect>, marks: BoardMark[],
): Promise<{ file: File; point: Point }> {
  const bounds = unionRects([...images.map(image => rects[image.id]), ...marks.map(markRect)]);
  if (!bounds) throw new Error('Select a sketch or a group to attach.');
  const padding = 12;
  const scale = Math.min(3, 2048 / Math.max(bounds.width + padding * 2, bounds.height + padding * 2));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((bounds.width + padding * 2) * scale);
  canvas.height = Math.ceil((bounds.height + padding * 2) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The board could not render the reference.');
  ctx.setTransform(scale, 0, 0, scale, (padding - bounds.x) * scale, (padding - bounds.y) * scale);
  const art = await Promise.all(images.map(async item => {
    const image = new Image();
    image.src = item.url;
    await image.decode();
    return image;
  }));
  for (const [index, item] of images.entries()) {
    const rect = rects[item.id], image = art[index];
    const cover = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const width = image.naturalWidth * cover, height = image.naturalHeight * cover;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.drawImage(image, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height);
    ctx.restore();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const mark of marks) drawMark(ctx, mark);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The board could not encode the reference.');
  const name = images.length || marks.length > 1 ? 'Canvas reference' : 'Canvas sketch';
  return { file: new File([blob], name + '.png', { type: 'image/png' }), point: { x: bounds.x + bounds.width + 18, y: bounds.y } };
}
