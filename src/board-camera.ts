import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { zoomAt, type Camera } from './board-geometry.js';

const WHEEL_IDLE_MS = 120;

export function useBoardCamera(
  viewport: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  camera: Camera,
  onCommit: (camera: Camera) => void,
  disabled: boolean,
) {
  const rendered = useRef(camera);
  const pending = useRef<Camera | null>(null);
  const committed = useRef<Camera | null>(null);
  const change = useRef(onCommit);
  const frame = useRef(0);
  const idle = useRef<number | undefined>(undefined);

  const paint = useCallback(() => {
    frame.current = 0;
    const node = content.current;
    if (!node) return;
    const next = pending.current;
    const base = rendered.current;
    // The children already use the rendered camera. Apply only the difference.
    const scale = next ? next.zoom / base.zoom : 1;
    node.style.transform = next
      ? `translate3d(${next.x - base.x * scale}px, ${next.y - base.y * scale}px, 0) scale(${scale})`
      : '';
  }, [content]);

  const preview = useCallback((next: Camera | null) => {
    pending.current = next;
    if (!frame.current) frame.current = window.requestAnimationFrame(paint);
  }, [paint]);

  const read = () => pending.current ?? rendered.current;

  const commit = useCallback((next: Camera) => {
    window.clearTimeout(idle.current);
    idle.current = undefined;
    const base = committed.current ?? rendered.current;
    if (next.x === base.x && next.y === base.y && next.zoom === base.zoom) {
      preview(committed.current);
      return;
    }
    preview(next);
    committed.current = next;
    change.current(next);
  }, [preview]);

  const finishWheel = useCallback(() => {
    if (idle.current !== undefined && pending.current) commit(pending.current);
  }, [commit]);

  useLayoutEffect(() => { change.current = onCommit; }, [onCommit]);
  useLayoutEffect(() => {
    rendered.current = camera;
    if (pending.current === camera || committed.current !== camera) pending.current = null;
    committed.current = null;
    // Rebase the transform before the browser paints the new child positions.
    window.cancelAnimationFrame(frame.current);
    paint();
  }, [camera, paint]);

  useEffect(() => {
    const node = viewport.current!;
    function wheel(event: WheelEvent) {
      if (disabled || (event.target as Element).closest('.board-controls, textarea')) return;
      event.preventDefault();
      const prev = pending.current ?? rendered.current;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const dx = event.deltaX * units, dy = event.deltaY * units;
      if (event.ctrlKey || event.metaKey) {
        const bounds = node.getBoundingClientRect();
        const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        preview(zoomAt(prev, point, prev.zoom * Math.exp(-dy * .011)));
      } else {
        const sideways = event.shiftKey && !dx;
        preview({ ...prev, x: prev.x - (sideways ? dy : dx), y: prev.y - (sideways ? 0 : dy) });
      }
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(finishWheel, WHEEL_IDLE_MS);
    }
    node.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', finishWheel);
    return () => {
      node.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', finishWheel);
    };
  }, [disabled, finishWheel, preview, viewport]);

  useLayoutEffect(() => () => {
    window.clearTimeout(idle.current);
    window.cancelAnimationFrame(frame.current);
  }, []);

  return { read, preview, commit, finishWheel };
}
