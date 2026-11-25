export function regionalWeights({data,width,height}) {
  const length = width * height
  const distance = new Uint16Array(length).fill(65535)
  let painted = 0
  for (let i = 0; i < length; i++) {
    if (data[i * 4 + 3] === 0) continue
    distance[i] = 0
    painted++
  }
  if (!painted) return null

  // Estimate distance to surviving paint with two 8-neighbor sweeps.
  // The cost is three units per orthogonal pixel, four along a diagonal.
  for (const step of [1,-1]) {
    const firstRow = step === 1 ? 0 : height - 1
    const firstColumn = step === 1 ? 0 : width - 1
    for (let y = firstRow; y >= 0 && y < height; y += step) {
      for (let x = firstColumn; x >= 0 && x < width; x += step) {
        const i = y * width + x
        if (distance[i] === 0) continue
        let nearest = distance[i]
        if (x !== firstColumn) nearest = Math.min(nearest, distance[i - step] + 3)
        if (y !== firstRow) {
          const above = i - width * step
          nearest = Math.min(nearest, distance[above] + 3)
          if (x > 0) nearest = Math.min(nearest, distance[above - 1] + 4)
          if (x + 1 < width) nearest = Math.min(nearest, distance[above + 1] + 4)
        }
        distance[i] = nearest
      }
    }
  }

  const shortEdge = Math.min(width,height)
  const margin = Math.max(1, Math.round(shortEdge * .025)) * 3
  // Larger marks get a broader fade, bounded relative to the illustration.
  const feather = Math.max(2, Math.round(Math.min(shortEdge * .09,
    Math.max(shortEdge * .04, Math.sqrt(painted) * .45)))) * 3
  const weights = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    const t = Math.min(1, Math.max(0, 1 - (distance[i] - margin) / feather))
    weights[i] = Math.round(255 * t * t * (3 - 2 * t))
  }
  return weights
}

export function blendRegional(source, generated, weights) {
  const output = Buffer.from(source)
  for (let pixel = 0; pixel < weights.length; pixel++) {
    const weight = weights[pixel]
    if (!weight) continue
    const i = pixel * 4
    if (weight === 255) {
      generated.copy(output,i,i,i + 4)
      continue
    }
    // Interpolate premultiplied colors so invisible RGB cannot tint the fade.
    const originalAlpha = source[i + 3] * (255 - weight)
    const generatedAlpha = generated[i + 3] * weight
    const alpha = originalAlpha + generatedAlpha
    output[i + 3] = Math.round(alpha / 255)
    for (let channel = i; channel < i + 3; channel++) {
      output[channel] = alpha ? Math.round(
        (source[channel] * originalAlpha + generated[channel] * generatedAlpha) / alpha) : 0
    }
  }
  return output
}
