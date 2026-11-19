import type { Guide, GuideLayer } from './model'

export function surface(width:number,height:number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d', {willReadFrequently:true})!
}

export function drawGuide(ctx:CanvasRenderingContext2D, guide:Guide) {
  const {width,height} = ctx.canvas
  const {pts,size,fill,erase,layer} = guide
  if (!pts.length) return
  ctx.save()
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  ctx.fillStyle = ctx.strokeStyle = layer === 'area' ? '#000' : '#0e8a8c'
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1,size * width)
  const [x,y] = pts[0]
  ctx.beginPath()
  if (pts.length === 1) {
    ctx.arc(x*width,y*height,ctx.lineWidth/2,0,Math.PI*2)
    ctx.fill()
  } else {
    ctx.moveTo(x*width,y*height)
    for (const [px,py] of pts.slice(1)) ctx.lineTo(px*width,py*height)
    if (fill) { ctx.closePath(); ctx.fill() }
    else ctx.stroke()
  }
  ctx.restore()
}

export function guideLayer(guides:Guide[],layer:GuideLayer,width:number,height:number) {
  const ctx = surface(width,height)
  guides.filter((g) => g.layer === layer).forEach((g) => drawGuide(ctx,g))
  return ctx
}

export function guidePercent(ctx:CanvasRenderingContext2D) {
  const {width,height} = ctx.canvas
  const pixels = ctx.getImageData(0,0,width,height).data
  let area = 0
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) area++
  return area * 100 / (width * height)
}

export function paintPreview(next:CanvasRenderingContext2D, area:CanvasRenderingContext2D,
    sketch?:CanvasRenderingContext2D, alpha=.62) {
  const {width,height} = next.canvas
  const hatch = surface(14,14)
  hatch.fillStyle = 'rgba(255,92,51,.5)'
  hatch.fillRect(0,0,14,14)
  hatch.strokeStyle = '#ff5c33'
  hatch.lineWidth = 3
  hatch.beginPath()
  for (const x of [-7,0,7]) { hatch.moveTo(x,x+14); hatch.lineTo(x+14,x) }
  hatch.stroke()
  const tint = surface(area.canvas.width,area.canvas.height)
  tint.drawImage(area.canvas,0,0)
  tint.globalCompositeOperation = 'source-in'
  tint.fillStyle = tint.createPattern(hatch.canvas,'repeat')!
  tint.fillRect(0,0,tint.canvas.width,tint.canvas.height)
  next.clearRect(0,0,width,height)
  next.globalAlpha = alpha
  next.drawImage(tint.canvas,0,0,width,height)
  next.globalAlpha = 1
  if (sketch) next.drawImage(sketch.canvas,0,0,width,height)
}
