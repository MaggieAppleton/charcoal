const turn = 2 * Math.PI;
export const halftoneStill = 1.4;

/** @param {CanvasRenderingContext2D} ctx @param {number} time @param {number} width @param {number} height */
export function drawHalftone(ctx, time, width, height) {
  ctx.fillStyle = '#ededed';
  ctx.fillRect(0, 0, width, height);

  const scale = Math.max(1, width / 352, height / 198);
  const step = 7 * scale;
  const phase = time * turn / 6.8;
  ctx.fillStyle = 'rgba(119, 119, 119, 0.56)';
  ctx.beginPath();
  for (let y = step * 4 / 7; y < height; y += step) {
    const bend = 0.15 * Math.sin(y / height * Math.PI);
    for (let x = step * 4 / 7; x < width; x += step) {
      const angle = turn * (x / width * 1.14 + bend) - phase;
      const crest = (1 + Math.cos(angle)) / 2;
      const radius = (0.48 + 1.35 * crest * crest) * scale;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, turn);
    }
  }
  ctx.fill();
}
