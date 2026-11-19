export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Camera = Point & { zoom: number };
export type BoardImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  url: string;
  originalUrl: string;
  seedGroup?: 'A' | 'B' | 'Stream' | 'Hill';
  shape?: 'square' | 'tall';
  candidate?: boolean;
  kept?: boolean;
  seen?: boolean;
  needsReview?: number;
  reviewStatus?: 'pending' | 'done' | 'failed';
  hasArea?: boolean;
};
export type BoardMark = {
  id: string;
  kind: 'pen' | 'arrow' | 'rect' | 'ellipse' | 'note';
  points: Point[];
  text?: string;
};
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const between = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
});
export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;
export const toWorld = (point: Point, camera: Camera): Point => ({
  x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom,
});
export const toScreen = (rect: Rect, camera: Camera): Rect => ({
  x: rect.x * camera.zoom + camera.x, y: rect.y * camera.zoom + camera.y,
  width: rect.width * camera.zoom, height: rect.height * camera.zoom,
});
export function zoomAt(camera: Camera, point: Point, zoom: number): Camera {
  const world = toWorld(point, camera);
  const z = clamp(zoom, .12, 6);
  return { x: point.x - world.x * z, y: point.y - world.y * z, zoom: z };
}

function seedRects(items: BoardImage[], width: number) {
  const narrow = width <= 640;
  const tile = narrow ? (width - 44) / 3 : clamp(width * .15, 108, 176);
  const column = narrow ? (width - 42) / 2 : tile * .7;
  const referencesWidth = column * 2 + 10;
  const groupGap = narrow ? 36 : clamp(width * .09, 40, 120);
  const rows = ['Stream', 'Hill'].map(group => items.filter(item => item.seedGroup === group));
  const rowsWidth = Math.max(0, ...rows.map(row => row.length * (tile + 6) - 6));
  const x = narrow ? 16 : Math.max(48, (width - referencesWidth - groupGap - rowsWidth) / 2);
  const y = narrow ? 60 : 72;
  const result: Record<string, Rect> = {};
  const columnEnds = ['A', 'B'].map((group, index) => {
    let top = y;
    for (const item of items.filter(item => item.seedGroup === group)) {
      const height = column * (item.shape === 'tall' ? 4 / 3 : item.shape === 'square' ? 1 : 9 / 16);
      result[item.id] = { x: x + index * (column + 10), y: top, width: column, height };
      top += height + 10;
    }
    return top - 10;
  });
  let top = narrow ? Math.max(...columnEnds) + groupGap : y;
  const rowLeft = narrow ? x : x + referencesWidth + groupGap;
  const height = tile * 9 / 16;
  for (const row of rows) {
    for (const [i, item] of row.entries()) {
      const rowIndex = narrow ? Math.floor(i / 3) : 0;
      const columnIndex = narrow ? i % 3 : i;
      result[item.id] = {
        x: rowLeft + columnIndex * (tile + 6), y: top + rowIndex * (height + 6),
        width: tile, height,
      };
    }
    const lineCount = narrow ? Math.ceil(row.length / 3) : Number(row.length > 0);
    if (lineCount) top += lineCount * (height + 6) - 6 + (narrow ? 28 : 44);
  }
  return result;
}

export function imageRects(items: BoardImage[], positions: Record<string, Rect>, width: number) {
  const seeds = seedRects(items, width);
  const unplaced = items.filter(item => !item.seedGroup && !positions[item.id]);
  const occupied = Object.values({ ...seeds, ...positions });
  const fallback = placeImages(unplaced, { x: 48, y: 72 }, occupied);
  return { ...seeds, ...fallback, ...positions };
}

export function placeImages(
  items: Array<Pick<BoardImage, 'id' | 'width' | 'height'>>,
  origin: Point,
  occupied: Rect[] = [],
) {
  const result: Record<string, Rect> = {};
  const placed = [...occupied];
  let top = origin.y;
  for (let start = 0; start < items.length; start += 3) {
    let left = origin.x;
    let bottom = top;
    for (const item of items.slice(start, start + 3)) {
      const scale = Math.min(176 / item.width, 180 / item.height);
      const rect = { x: left, y: top, width: item.width * scale, height: item.height * scale };
      while (true) {
        const overlap = placed.find(other =>
          rect.x < other.x + other.width + 12 && other.x < rect.x + rect.width + 12 &&
          rect.y < other.y + other.height + 12 && other.y < rect.y + rect.height + 12);
        if (!overlap) break;
        rect.y = overlap.y + overlap.height + 12;
      }
      result[item.id] = rect;
      placed.push(rect);
      left += rect.width + 12;
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    top = bottom + 12;
  }
  return result;
}
