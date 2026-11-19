import { useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { between, distance, intersects, toWorld, zoomAt } from './board-geometry.js';
import type { BoardMark, Camera, Point, Rect } from './board-geometry.js';
import { hitMark, markRect } from './board-marks.js';

export type BoardTool = 'select' | 'hand' | 'erase' | BoardMark['kind'];
export type BoardPatch = {
  positions?: Record<string, Rect>;
  camera?: Camera;
  annotations?: BoardMark[];
};

type Gesture =
  | { kind: 'pan'; original: Camera }
  | { kind: 'move'; image?: string; mark?: string; images: string[]; marks: string[] }
  | { kind: 'resize'; image: string }
  | { kind: 'marquee' }
  | { kind: 'erase'; ids: Set<string> }
  | { kind: 'draw'; mark: BoardMark };

type PointerGesture = {
  pointer: number;
  screen: Point;
  world: Point;
  lastWorld: Point;
  moved: boolean;
  gesture: Gesture;
  shift: boolean;
};

type Preview = {
  camera?: Camera;
  positions?: Record<string, Rect>;
  marks?: BoardMark[];
  marquee?: Rect;
  drawing?: BoardMark;
};
type Options = {
  viewport: RefObject<HTMLDivElement | null>;
  camera: Camera;
  tool: BoardTool;
  space: RefObject<boolean>;
  marks: BoardMark[];
  positions: Record<string, Rect>;
  attachments: string[];
  imageSelection: Set<string> | null;
  markSelection: string[];
  onCommit: (patch: BoardPatch) => void;
  onToggle: (id: string) => void;
  onActive: (id: string | null) => void;
  onSelectMarks: (ids: string[]) => void;
  onMarqueeImages: (ids: string[]) => void;
  onNewNote: (mark: BoardMark) => void;
};

function selectGesture(
  element: Element, point: Point, shift: boolean, opts: Options,
): Gesture {
  const resize = (element.closest('[data-board-resize]') as HTMLElement | null)?.dataset.boardResize;
  if (resize) return { kind: 'resize', image: resize };
  const selected = Array.from(opts.imageSelection ?? opts.attachments).filter(id => opts.positions[id]);
  const mark = opts.marks.findLast(item => hitMark(item, point, 6 / opts.camera.zoom));
  if (mark) return {
    kind: 'move', mark: mark.id,
    images: opts.markSelection.includes(mark.id) ? selected : [],
    marks: opts.markSelection.includes(mark.id) ? opts.markSelection : [mark.id],
  };
  const image = (element.closest('[data-board-image]') as HTMLElement | null)?.dataset.boardImage;
  if (image) return {
    kind: 'move', image,
    images: selected.includes(image) ? selected : [image],
    marks: shift || selected.includes(image) ? opts.markSelection : [],
  };
  return { kind: 'marquee' };
}

function startGesture(event: PointerEvent, screen: Point, opts: Options): PointerGesture {
  const world = toWorld(screen, opts.camera);
  let gesture: Gesture;
  if (event.button === 1 || opts.space.current || opts.tool === 'hand') {
    gesture = { kind: 'pan', original: opts.camera };
  } else if (opts.tool === 'erase') {
    gesture = { kind: 'erase', ids: new Set() };
  } else if (opts.tool !== 'select') {
    gesture = { kind: 'draw', mark: { id: crypto.randomUUID(), kind: opts.tool, points: [world] } };
  } else {
    gesture = selectGesture(event.target as Element, world, event.shiftKey, opts);
    if (gesture.kind === 'marquee' && event.pointerType === 'touch' && !event.shiftKey) {
      gesture = { kind: 'pan', original: opts.camera };
    }
  }
  return { pointer: event.pointerId, screen, world, lastWorld: world, moved: false, gesture, shift: event.shiftKey };
}

function eraseAlong(opts: Options, ids: Set<string>, start: Point, end: Point) {
  const step = 6 / opts.camera.zoom;
  const n = Math.min(128, Math.max(1, Math.ceil(distance(start, end) / step)));
  for (let i = 0; i <= n; i++) {
    const progress = i / n;
    const point = { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
    for (const mark of opts.marks) {
      if (!ids.has(mark.id) && hitMark(mark, point, step)) ids.add(mark.id);
    }
  }
}

function gesturePreview(active: PointerGesture, screen: Point, opts: Options): Preview {
  const { gesture } = active;
  const point = toWorld(screen, opts.camera);
  const dx = point.x - active.world.x, dy = point.y - active.world.y;
  const moved = active.moved ||= distance(screen, active.screen) > 4;
  const previous = active.lastWorld;
  active.lastWorld = point;
  switch (gesture.kind) {
    case 'pan':
      return moved ? { camera: {
        ...gesture.original,
        x: gesture.original.x + screen.x - active.screen.x,
        y: gesture.original.y + screen.y - active.screen.y,
      } } : {};
    case 'move': {
      if (!moved) return {};
      const positions: Record<string, Rect> = {};
      for (const id of gesture.images) {
        const rect = opts.positions[id];
        if (rect) positions[id] = { ...rect, x: rect.x + dx, y: rect.y + dy };
      }
      return {
        positions,
        marks: opts.marks.map(mark => gesture.marks.includes(mark.id)
          ? { ...mark, points: mark.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
          : mark),
      };
    }
    case 'resize': {
      const rect = opts.positions[gesture.image];
      if (!moved || !rect) return {};
      const axis = Math.abs(dx) >= Math.abs(dy) ? dx : dy * rect.width / rect.height;
      const width = Math.max(32, rect.width + axis);
      return { positions: { [gesture.image]: { ...rect, width, height: width * rect.height / rect.width } } };
    }
    case 'marquee':
      return moved ? { marquee: between(active.world, point) } : {};
    case 'erase':
      eraseAlong(opts, gesture.ids, previous, point);
      return { marks: opts.marks.filter(mark => !gesture.ids.has(mark.id)) };
    case 'draw': {
      const { mark } = gesture;
      if (mark.kind === 'note') return { drawing: mark };
      if (mark.kind === 'pen') {
        if (distance(mark.points.at(-1)!, point) * opts.camera.zoom >= 1 && mark.points.length < 12000) {
          mark.points.push(point);
        }
      } else {
        mark.points = [active.world, point];
      }
      return { drawing: { ...mark, points: [...mark.points] } };
    }
  }
}

const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useBoardGestures(options: Options) {
  const [preview, setPreview] = useState<Preview>({});
  const current = useRef<PointerGesture | null>(null);
  const contacts = useRef(new Map<number, Point>());
  const pinch = useRef<{ camera: Camera; start: Point; span: number; ids: number[]; latest: Camera } | null>(null);
  const clientPoint = (event: PointerEvent): Point => {
    const bounds = options.viewport.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const element = event.target as Element;
    if (element.closest('button:not([data-board-image], [data-board-resize]), textarea, input, .board-job, .ctx')) return;
    const screen = clientPoint(event);
    if (event.pointerType === 'touch') {
      contacts.current.set(event.pointerId, screen);
      if (contacts.current.size === 2) {
        const [a, b] = [...contacts.current.values()];
        const camera = preview.camera ?? options.camera;
        pinch.current = {
          camera, start: midpoint(a, b), span: Math.max(1, distance(a, b)),
          ids: [...contacts.current.keys()], latest: camera,
        };
        current.current = null;
        setPreview({ camera });
      }
    }
    if (!pinch.current && !current.current) {
      current.current = startGesture(event, screen, options);
      const wanted = current.current.gesture.kind;
      if (wanted === 'draw' || wanted === 'erase') setPreview(gesturePreview(current.current, screen, options));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 1) event.preventDefault();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pinch.current && contacts.current.has(event.pointerId)) {
      contacts.current.set(event.pointerId, clientPoint(event));
      const state = pinch.current;
      const [a, b] = state.ids.map(id => contacts.current.get(id)!);
      const center = midpoint(a, b);
      const next = zoomAt(state.camera, state.start, state.camera.zoom * distance(a, b) / state.span);
      state.latest = { ...next, x: next.x + center.x - state.start.x, y: next.y + center.y - state.start.y };
      setPreview({ camera: state.latest });
    } else if (current.current?.pointer === event.pointerId) {
      const point = clientPoint(event);
      if (contacts.current.has(event.pointerId)) contacts.current.set(event.pointerId, point);
      setPreview(gesturePreview(current.current, point, options));
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    contacts.current.delete(event.pointerId);
    if (pinch.current) {
      if (!pinch.current.ids.includes(event.pointerId)) return;
      if (!cancelled) options.onCommit({ camera: pinch.current.latest });
      pinch.current = null;
      setPreview({});
      return;
    }
    const active = current.current;
    if (!active || active.pointer !== event.pointerId) return;
    current.current = null;
    setPreview({});
    if (cancelled) return;
    const { gesture } = active;
    const final = gesturePreview(active, clientPoint(event), options);
    const patch: BoardPatch = {};
    if (final.camera) patch.camera = final.camera;
    if (final.positions && Object.keys(final.positions).length) {
      patch.positions = final.positions;
    }
    if (final.marks && (gesture.kind === 'move' && gesture.marks.length || final.marks.length !== options.marks.length)) {
      patch.annotations = final.marks;
    }
    if (patch.camera || patch.positions || patch.annotations) {
      options.onCommit(patch);
      return;
    }
    if (final.drawing && (active.moved || final.drawing.kind === 'pen' || final.drawing.kind === 'note')) {
      const mark = final.drawing;
      if (mark.kind === 'note') options.onNewNote(mark);
      else options.onCommit({ annotations: [...options.marks, mark] });
      options.onSelectMarks([mark.id]);
      return;
    }
    if (final.marquee) {
      const rect = final.marquee;
      options.onSelectMarks(options.marks.filter(mark => intersects(markRect(mark), rect)).map(mark => mark.id));
      options.onMarqueeImages(Object.keys(options.positions).filter(id => intersects(options.positions[id], rect)));
      return;
    }
    if (gesture.kind === 'move') {
      if (gesture.mark) {
        const id = gesture.mark;
        const next = !active.shift ? [id] : options.markSelection.includes(id)
          ? options.markSelection.filter(selected => selected !== id) : [...options.markSelection, id];
        options.onActive(null);
        options.onSelectMarks(next);
      } else if (!active.shift) {
        options.onSelectMarks([]);
      }
      if (gesture.image) options.onToggle(gesture.image);
    } else if (gesture.kind === 'marquee' || gesture.kind === 'pan') {
      options.onSelectMarks([]);
      options.onActive(null);
    }
  }

  return {
    preview, onPointerDown, onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
  };
}
