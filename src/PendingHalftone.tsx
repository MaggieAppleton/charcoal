import { useEffect, useRef } from 'react';
import { drawHalftone, halftoneStill } from './halftone.js';

export function PendingHalftone() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const painter = ctx;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let onScreen = false;
    let frame = 0;
    let start = 0;

    function draw(time: number) {
      if (width && height) drawHalftone(painter, time, width, height);
    }

    function tick(now: number) {
      draw(halftoneStill + (now - start) / 1000);
      frame = requestAnimationFrame(tick);
    }

    function reconcile() {
      const animate = onScreen && !document.hidden && !motion.matches;
      if (animate && !frame) {
        start = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (!animate && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        draw(halftoneStill);
      }
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      if (!width || !height) return;
      const ratio = Math.min(devicePixelRatio || 1, 2, 1200 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      painter.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      draw(halftoneStill + (frame ? (performance.now() - start) / 1000 : 0));
    }

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      reconcile();
    });
    visibilityObserver.observe(canvas);
    motion.addEventListener('change', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      motion.removeEventListener('change', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, []);

  return <canvas ref={ref} className="board-job-halftone" aria-hidden="true" />;
}
