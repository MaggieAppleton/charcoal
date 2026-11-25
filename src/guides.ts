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
  ctx.fillStyle = ctx.strokeStyle = layer === 'area' ? '#000' : guide.tool ? '#c63832' : '#0e8a8c'
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1,size * width)
  const [x,y] = pts[0]
  ctx.beginPath()
  if (!erase && guide.tool === 'text') {
    drawNote(ctx,guide.text ?? '',x,y)
  } else if (!erase && guide.tool === 'rectangle' && pts.length > 1) {
    const [ex,ey] = pts.at(-1)!
    ctx.strokeRect(x*width,y*height,(ex-x)*width,(ey-y)*height)
  } else if (!erase && guide.tool === 'arrow' && pts.length > 1) {
    const [ex,ey] = pts.at(-1)!
    const angle = Math.atan2((ey-y)*height,(ex-x)*width)
    const head = Math.max(ctx.lineWidth*3,width*.016)
    ctx.moveTo(x*width,y*height)
    ctx.lineTo(ex*width,ey*height)
    ctx.moveTo(ex*width-head*Math.cos(angle-.5),ey*height-head*Math.sin(angle-.5))
    ctx.lineTo(ex*width,ey*height)
    ctx.lineTo(ex*width-head*Math.cos(angle+.5),ey*height-head*Math.sin(angle+.5))
    ctx.stroke()
  } else if (pts.length === 1) {
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

function drawNote(ctx:CanvasRenderingContext2D,text:string,x:number,y:number) {
  if (!text.trim()) return
  const {width,height}=ctx.canvas
  const font=Math.max(9,width*.024)
  const pad=font*.25
  const lineHeight=font*1.25
  const maxWidth=Math.min(width-pad*2,width*.42)
  ctx.font=`500 ${font}px sans-serif`
  ctx.textBaseline='top'
  const lines:string[]=[]
  for (const paragraph of text.split('\n')) {
    let line=''
    for (const character of paragraph) {
      if (line && ctx.measureText(line+character).width>maxWidth) { lines.push(line);line='' }
      line+=character
    }
    lines.push(line)
  }
  const boxWidth=Math.min(width,Math.max(...lines.map(line=>ctx.measureText(line).width))+pad*2)
  const boxHeight=lines.length*lineHeight+pad*2
  const left=Math.max(0,Math.min(x*width,width-boxWidth))
  const top=Math.max(0,Math.min(y*height,height-boxHeight))
  ctx.fillStyle='rgba(255,255,255,.94)'
  ctx.fillRect(left,top,boxWidth,Math.min(height,boxHeight))
  ctx.fillStyle='#c63832'
  lines.forEach((line,index)=>ctx.fillText(line,left+pad,top+pad+index*lineHeight))
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
