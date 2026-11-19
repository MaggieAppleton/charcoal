import {useEffect, useLayoutEffect, useRef, useState, type PointerEvent} from 'react'
import {segmentKeys} from './segmented'
import {Icon} from './Icon.js'
import {ImageStage} from './ImageStage'
import {guideLayer, guidePercent, paintPreview} from './guides'
import type {Asset,Guide,GuideLayer,GuideMode} from './model'

export function Edit({asset,guides,mode,onChange,onClose,origin}:{
  asset:Asset
  guides:Guide[]
  mode:GuideMode
  onChange:(guides:Guide[],mode:GuideMode)=>void
  onClose:()=>void
  origin?:DOMRect
}) {
  const [layer,setLayer] = useState<GuideLayer>(mode === 'markup' ? 'sketch' : 'area')
  const [erase,setErase] = useState(false)
  const [visible,setVisible] = useState(true)
  const [sizes,setSizes] = useState({area:96,sketch:12})
  const [draft,setDraft] = useState<Guide|null>(null)
  const [cursor,setCursor] = useState<[number,number]|null>(null)
  const [history,setHistory] = useState<Guide[][]>([])
  const [percentage,setPercentage] = useState(0)
  const pointer = useRef<Guide|null>(null)
  const layerButton = useRef<HTMLButtonElement>(null)

  function apply(next:Guide[], preferred:GuideLayer) {
    const mask = guideLayer(next,'area',asset.width,asset.height)
    const sketch = guideLayer(next,'sketch',asset.width,asset.height)
    const hasMask = guidePercent(mask) > 0
    const hasSketch = guidePercent(sketch) > 0
    const nextMode = preferred === 'area'
      ? hasMask ? 'mask' : hasSketch ? 'markup' : 'whole'
      : hasSketch ? 'markup' : hasMask ? 'mask' : 'whole'
    onChange(next,nextMode)
  }

  function update(next:Guide[]) {
    setHistory((previous) => [...previous,guides])
    apply(next,layer)
  }

  function undo() {
    const last = history.at(-1)
    if (last) {
      apply(last,layer)
      setHistory(history.slice(0,-1))
    }
  }

  function changeSize(value:number) {
    setSizes({...sizes,[layer]:Math.min(layer === 'area' ? 240 : 72,Math.max(layer === 'area' ? 12 : 4,value))})
  }

  useEffect(() => { layerButton.current?.focus({preventScroll:true}) },[])
  useEffect(() => {
    const listen = (e:KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('textarea,input,[contenteditable]') || e.defaultPrevented) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'z') { e.preventDefault(); undo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (key === 'a') setLayer('area')
      if (key === 's') setLayer('sketch')
      if (key === 'b') setErase(false)
      if (key === 'e') setErase(true)
      if (key === '[' || key === ']') changeSize(sizes[layer] + (key === '[' ? -8 : 8))
    }
    window.addEventListener('keydown',listen)
    return () => window.removeEventListener('keydown',listen)
  })

  const size = sizes[layer]
  function point(e:PointerEvent<HTMLCanvasElement>):[number,number] {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))]
  }

  const tools = <div className="tools" id="editTools" role="toolbar" aria-label="Edit area tools">
    <div className="seg" role="radiogroup" aria-label="Layer" onKeyDown={segmentKeys}>
      <button type="button" ref={layerButton} role="radio" data-layer="area" aria-checked={layer==='area'} tabIndex={(layer==='area')?0:-1} onClick={()=>setLayer('area')} data-tip="Paint where the image may change (A)"><Icon name="brush"/>Edit area</button>
      <button type="button" role="radio" data-layer="sketch" aria-checked={layer==='sketch'} tabIndex={(layer==='sketch')?0:-1} onClick={()=>setLayer('sketch')} data-tip="Draw guide lines on top (S)"><Icon name="pen"/>Sketch</button>
    </div>
    <div className="seg" role="radiogroup" aria-label="Tool" onKeyDown={segmentKeys}>
      <button type="button" className="ico" role="radio" aria-checked={!erase} tabIndex={(!erase)?0:-1} onClick={()=>setErase(false)} aria-label="Paint" data-tip="Paint (B)"><Icon name="circleDot"/></button>
      <button type="button" className="ico" role="radio" aria-checked={erase} tabIndex={(erase)?0:-1} onClick={()=>setErase(true)} aria-label="Erase" data-tip="Erase (E)"><Icon name="eraser"/></button>
    </div>
    <label className="size"><span className="muted">Size</span><input type="range" min={layer === 'area' ? 12 : 4} max={layer === 'area' ? 240 : 72} step="2" value={size} onChange={(e)=>changeSize(Number(e.target.value))} aria-label="Brush size"/><output>{size} px</output></label>
    <span className="sep"/>
    <button type="button" className="btn icon" onClick={undo} disabled={!history.length} aria-label="Undo" data-tip="Undo (⌘Z)"><Icon name="undo"/></button>
    <button type="button" className="btn icon" onClick={()=>update(guides.filter((g)=>g.layer!==layer))} aria-label="Clear this layer" data-tip="Clear layer"><Icon name="trash"/></button>
    <button type="button" className="btn icon" aria-pressed={!visible} onClick={()=>setVisible(!visible)} aria-label={visible?'Hide overlay':'Show overlay'} data-tip={visible?'Hide overlay':'Show overlay'}><Icon name={visible?'eye':'eyeOff'}/></button>
    <span className="sep"/>
    <button type="button" className="btn primary" onClick={onClose}>Done</button>
  </div>
  const pct = Math.min(100,Math.max(1,Math.round(percentage)))
  const readout = percentage && (draft ? draft.layer==='area' : mode==='mask')
    ? <>Sunburst can change the <span className="k-area">painted {pct}%</span>. The other {100-pct}% keeps its original pixels.</>
    : mode === 'markup'
      ? <><span className="k-sketch">Sketch lines</span> show where things go. The whole image may change.</>
      : <>Paint over the part of <b>{asset.name}</b> that should change.</>
  return <ImageStage asset={asset} tools={tools} readout={readout} onClose={onClose} origin={origin}>
    {(width,height) => <PaintCanvas width={width} height={height} guides={draft?[...guides,draft]:guides}
      visible={visible} onPercent={setPercentage}
      onPointerDown={(e)=>{
        if (pointer.current || e.button!==0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const pt = point(e)
        setVisible(true)
        pointer.current = {layer,size:size/1536,erase,pts:[pt]}
        setCursor(pt)
        setDraft(pointer.current)
      }}
      onPointerMove={(e)=>{
        const pt = point(e)
        setCursor(pt)
        if (pointer.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
          pointer.current = {...pointer.current,pts:[...pointer.current.pts,pt]}
          setDraft(pointer.current)
        }
      }}
      onPointerUp={(e)=>{
        if (!pointer.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
        update([...guides,pointer.current])
        pointer.current = null
        setDraft(null)
      }}
      onPointerCancel={()=>{pointer.current=null;setDraft(null);setCursor(null)}}
      onPointerLeave={()=>setCursor(null)}
      cursor={cursor} diameter={Math.max(6,size/1536*width)} erase={erase}/>}
  </ImageStage>
}

function PaintCanvas({width,height,guides,visible,onPercent,cursor,diameter,erase,...events}:{
  width:number; height:number; guides:Guide[]; visible:boolean; onPercent:(n:number)=>void
  cursor:[number,number]|null; diameter:number; erase:boolean
} & React.DOMAttributes<HTMLCanvasElement>) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const scale = Math.min(960 / width, 960 / height)
    const w = Math.max(1,Math.round(width*scale))
    const h = Math.max(1,Math.round(height*scale))
    const area = guideLayer(guides,'area',w,h)
    onPercent(guidePercent(area))
    if (visible) paintPreview(ctx,area,guideLayer(guides,'sketch',w,h))
    else ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height)
  },[guides,visible,width,height,onPercent])
  return <>
    <canvas className="ov paint-surface" role="img" aria-label="Painting surface" ref={ref}
      width={Math.round(width*devicePixelRatio)} height={Math.round(height*devicePixelRatio)} {...events}/>
    {cursor && <span className={`cursor${erase?' erase':''}`} style={{
      left:cursor[0]*width,top:cursor[1]*height,width:diameter,height:diameter,
    }}/>}
  </>
}
