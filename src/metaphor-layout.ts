import {type Point, type Rect} from './board-geometry'

export const METAPHOR_SIZE = {
  brief: {width: 144, height: 36},
  option: {width: 224, height: 96},
}

const gap = 20
const runHeight = (count: number) => count * (METAPHOR_SIZE.option.height + gap) - gap

// Step past the obstacle in one direction. Each step clears at least one obstacle.
function clear(rect: Rect, obstacles: Rect[], axis: 'x' | 'y', direction: number): Rect {
  const size = axis === 'x' ? 'width' : 'height'
  while (true) {
    const hits = obstacles.filter(other =>
      rect.x > other.x - rect.width - gap && rect.x < other.x + other.width + gap &&
      rect.y > other.y - rect.height - gap && rect.y < other.y + other.height + gap)
    if (!hits.length) return rect
    const edges = hits.map(other => direction > 0 ? other[axis] + other[size] + gap : other[axis] - rect[size] - gap)
    rect = {...rect, [axis]: direction > 0 ? Math.max(...edges) : Math.min(...edges)}
  }
}

function nearest(rect: Rect, obstacles: Rect[], view?: Rect): Rect {
  const candidates = [clear(rect, obstacles, 'y', 1), clear(rect, obstacles, 'x', 1),
    clear(rect, obstacles, 'y', -1), clear(rect, obstacles, 'x', -1)]
  const visible = (r: Rect) => view && r.x >= view.x && r.y >= view.y &&
    r.x + r.width <= view.x + view.width && r.y + r.height <= view.y + view.height
  const cost = (r: Rect) => Math.hypot(r.x - rect.x, r.y - rect.y)
  return candidates.sort((a,b) => Number(!!visible(b)) - Number(!!visible(a)) || cost(a) - cost(b))[0]
}

export function briefLocation(view: Rect, obstacles: Rect[]): Point {
  const width = METAPHOR_SIZE.brief.width + 2 * gap + METAPHOR_SIZE.option.width
  const height = runHeight(3)
  const group = nearest({x: view.x + Math.max(0,(view.width - width)/2),
    y: view.y + Math.max(0,(view.height - height)/2), width, height}, obstacles, view)
  return {x: group.x, y: group.y + (height - METAPHOR_SIZE.brief.height)/2}
}

export function optionLocations(source: Rect, count: number, obstacles: Rect[], view?: Rect): Point[] {
  const height = runHeight(count)
  const column = nearest({x: source.x + source.width + 2 * gap, y: source.y + (source.height - height)/2,
    width: METAPHOR_SIZE.option.width, height}, obstacles, view)
  return Array.from({length: count}, (_,index) => ({
    x: column.x, y: column.y + index * (METAPHOR_SIZE.option.height + gap),
  }))
}

export function promptLocation(option: Rect, size: Rect, obstacles: Rect[]): Point {
  const {x,y} = nearest({...size, x: option.x + option.width + 2 * gap, y: option.y}, obstacles)
  return {x,y}
}

export function metaphorWire(source: Rect, option: Rect) {
  const center = (r: Rect) => ({x: r.x + r.width/2, y: r.y + r.height/2})
  const a = center(source), b = center(option)
  const dx = b.x - a.x, dy = b.y - a.y
  const horizontal = Math.abs(dx) >= (source.width + option.width)/2 || Math.abs(dy) < (source.height + option.height)/2
  if (horizontal) {
    const side = Math.sign(dx) || 1
    const start = a.x + side * source.width/2, end = b.x - side * option.width/2
    const mid = (start + end)/2
    return `M ${start} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${end} ${b.y}`
  }
  const side = Math.sign(dy)
  const start = a.y + side * source.height/2, end = b.y - side * option.height/2
  const mid = (start + end)/2
  return `M ${a.x} ${start} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${end}`
}
