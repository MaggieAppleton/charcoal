import {useEffect, useLayoutEffect, useRef, useState, type PointerEvent} from 'react'
import {segmentKeys} from './segmented'
import {Icon} from './Icon.js'
import {ImageStage} from './ImageStage'
import {guideLayer, guidePercent, paintPreview} from './guides'
import type {Asset,Guide,GuideLayer,GuideMode} from './model'
import './redline.css'

type AnnotationTool = 'pen'|'arrow'|'rectangle'|'text'
type Note = {point:[number,number];text:string}
const annotationTools:{tool:AnnotationTool;label:string;icon:string}[] = [
  {tool:'pen',label:'Pen',icon:'pen'},
  {tool:'arrow',label:'Arrow',icon:'arrowRight'},
  {tool:'rectangle',label:'Box',icon:'square'},
  {tool:'text',label:'Text note',icon:'lines'},
]

export function Edit({asset,guides,mode,onChange,onClose,origin,initialLayer}: {
  asset:Asset
  guides:Guide[]
  mode:GuideMode
  onChange:(guides:Guide[],mode:GuideMode)=>void
  onClose:()=>void
  origin?:DOMRect
  initialLayer?:GuideLayer
}) {
  const [layer,setLayer] = useState<GuideLayer>(initialLayer ?? (mode === 'markup' ? 'sketch' : 'area'))
  const [tool,setTool] = useState<AnnotationTool>('pen')
  const [erase,setErase] = useState(false)
  const [visible,setVisible] = useState(true)
  const [sizes,setSizes] = useState({area:96,sketch:8})
  const [draft,setDraft] = useState<Guide|null>(null)
  const [note,setNote] = useState<Note|null>(null)
  const [cursor,setCursor] = useState<[number,number]|null>(null)
  const [history,setHistory] = useState<Guide[][]>([])
  const [percentage,setPercentage] = useState(0)
  const pointer = useRef<Guide|null>(null)
  const latestGuides = useRef(guides)
  const pendingNote = useRef<Note|null>(null)
  const layerButton = useRef<HTMLButtonElement>(null)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  latestGuides.current=guides

  function apply(next:Guide[], preferred:GuideLayer) {
    latestGuides.current=next
    const scale=Math.min(1,960/Math.max(asset.width,asset.height))
    const width=Math.max(1,Math.round(asset.width*scale))
    const height=Math.max(1,Math.round(asset.height*scale))
    const hasMask = guidePercent(guideLayer(next,'area',width,height)) > 0
    const hasSketch = guidePercent(guideLayer(next,'sketch',width,height)) > 0
    const nextMode = preferred === 'area'
      ? hasMask ? 'mask' : hasSketch ? 'markup' : 'whole'
      : hasSketch ? 'markup' : hasMask ? 'mask' : 'whole'
    onChange(next,nextMode)
  }

  function update(next:Guide[],preferred=layer) {
    const before=latestGuides.current
    setHistory(previous=>[...previous,before])
    apply(next,preferred)
  }

  function editNote(next:Note|null) {
    pendingNote.current=next
    setNote(next)
  }

  function saveNote() {
    const current=pendingNote.current
    if (!current) return
    editNote(null)
    if (current.text.trim()) update([...latestGuides.current,{
      layer:'sketch',tool:'text',size:0,pts:[current.point],text:current.text.trim(),
    }],'sketch')
  }

  function close() { saveNote(); onClose() }
  function chooseLayer(next:GuideLayer) {
    saveNote()
    setLayer(next)
    setErase(false)
    apply(latestGuides.current,next)
  }
  function chooseTool(next:AnnotationTool) { saveNote(); setTool(next); setErase(false) }
  function undo() {
    if (pendingNote.current) { editNote(null); return }
    const last = history.at(-1)
    if (last) { apply(last,layer); setHistory(history.slice(0,-1)) }
  }
  function changeSize(value:number) {
    setSizes({...sizes,[layer]:Math.min(layer === 'area' ? 240 : 72,Math.max(layer === 'area' ? 12 : 4,value))})
  }

  useEffect(() => { layerButton.current?.focus({preventScroll:true}) },[])
  useEffect(() => { if (note) noteInput.current?.focus({preventScroll:true}) },[note?.point])
  useEffect(() => {
    const listen = (e:KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('textarea,input,[contenteditable]') || e.defaultPrevented) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'z') { e.preventDefault(); undo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (key === 'a') chooseLayer('area')
      if (key === 's') chooseLayer('sketch')
      if (key === 'b') chooseTool('pen')
      if (key === 'e') { saveNote(); setErase(true) }
      if (key === 't' && layer==='sketch') chooseTool('text')
      if (key === '[' || key === ']') changeSize(sizes[layer] + (key === '[' ? -8 : 8))
    }
    window.addEventListener('keydown',listen)
    return () => window.removeEventListener('keydown',listen)
  })

  const size = sizes[layer]
  const textTool=layer==='sketch' && tool==='text' && !erase
  function point(e:PointerEvent<HTMLCanvasElement>):[number,number] {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))]
  }
  function cancelStroke() { pointer.current=null; setDraft(null); setCursor(null) }

  const tools = <div className="tools redline-tools" id="editTools" role="toolbar" aria-label="Image editing tools">
    <div className="seg" role="radiogroup" aria-label="Layer" onKeyDown={segmentKeys}>
      <button type="button" ref={layer==='area'?layerButton:undefined} role="radio" data-layer="area" aria-checked={layer==='area'} tabIndex={layer==='area'?0:-1} onClick={()=>chooseLayer('area')} data-tip="Paint to guide a local edit (A)"><Icon name="brush"/>Edit area</button>
      <button type="button" ref={layer==='sketch'?layerButton:undefined} role="radio" data-layer="sketch" aria-checked={layer==='sketch'} tabIndex={layer==='sketch'?0:-1} onClick={()=>chooseLayer('sketch')} data-tip="Draw revision instructions on the image (S)"><Icon name="pen"/>Annotate</button>
    </div>
    <div className="seg" role="radiogroup" aria-label="Tool" onKeyDown={segmentKeys}>
      {layer==='area'
        ? <button type="button" className="ico" role="radio" aria-checked={!erase} tabIndex={!erase?0:-1} onClick={()=>setErase(false)} aria-label="Paint" data-tip="Paint (B)"><Icon name="circleDot"/></button>
        : annotationTools.map(entry=><button key={entry.tool} type="button" className="ico" role="radio" aria-checked={!erase&&tool===entry.tool} tabIndex={!erase&&tool===entry.tool?0:-1} onClick={()=>chooseTool(entry.tool)} aria-label={entry.label} data-tip={entry.label}><Icon name={entry.icon}/></button>)}
      <button type="button" className="ico" role="radio" aria-checked={erase} tabIndex={erase?0:-1} onClick={()=>{saveNote();setErase(true)}} aria-label="Erase" data-tip="Erase (E)"><Icon name="eraser"/></button>
    </div>
    {!textTool && <label className="size"><span className="muted">Size</span><input type="range" min={layer === 'area' ? 12 : 4} max={layer === 'area' ? 240 : 72} step="2" value={size} onChange={e=>changeSize(Number(e.target.value))} aria-label="Brush size"/><output>{size} px</output></label>}
    <span className="sep"/>
    <button type="button" className="btn icon" onClick={undo} disabled={!history.length&&!note} aria-label="Undo" data-tip="Undo (⌘Z)"><Icon name="undo"/></button>
    <button type="button" className="btn icon" onClick={()=>{editNote(null);update(latestGuides.current.filter(g=>g.layer!==layer))}} aria-label="Clear this layer" data-tip="Clear layer"><Icon name="trash"/></button>
    <button type="button" className="btn icon" aria-pressed={!visible} onClick={()=>{saveNote();setVisible(!visible)}} aria-label={visible?'Hide overlay':'Show overlay'} data-tip={visible?'Hide overlay':'Show overlay'}><Icon name={visible?'eye':'eyeOff'}/></button>
    <span className="sep"/>
    <button type="button" className="btn primary" onClick={close}>Done</button>
  </div>
  const pct = Math.min(100,Math.max(1,Math.round(percentage)))
  const readout = layer==='sketch'
    ? <><span className="redline-label">Annotations</span> guide the revision. The whole image may change.</>
    : percentage
      ? <>The <span className="k-area">painted {pct}%</span> guides the edit. Changes blend into the surrounding image.</>
      : <>Paint over the part of <b>{asset.name}</b> that should change.</>
  return <ImageStage asset={asset} tools={tools} readout={readout} onClose={close} origin={origin}>
    {(width,height) => <>
      <PaintCanvas width={width} height={height} guides={draft?[...guides,draft]:guides}
        visible={visible} onPercent={setPercentage} textTool={textTool}
        onPointerDown={e=>{
          if (pointer.current || e.button!==0 || !e.isPrimary) return
          saveNote()
          const pt = point(e)
          setVisible(true)
          if (textTool) { e.preventDefault();editNote({point:pt,text:''});setCursor(null);return }
          e.currentTarget.setPointerCapture(e.pointerId)
          pointer.current = {layer,size:size/1536,erase,pts:[pt],...(layer==='sketch'?{tool}: {})}
          setCursor(pt)
          setDraft(pointer.current)
        }}
        onPointerMove={e=>{
          const pt = point(e)
          setCursor(pt)
          if (pointer.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
            const shape=!pointer.current.erase && ['arrow','rectangle'].includes(pointer.current.tool ?? '')
            pointer.current = {...pointer.current,pts:shape?[pointer.current.pts[0],pt]:[...pointer.current.pts,pt]}
            setDraft(pointer.current)
          }
        }}
        onPointerUp={e=>{
          if (!pointer.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
          const stroke=pointer.current
          pointer.current=null
          setDraft(null)
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (stroke.pts.length>1 || stroke.erase || !['arrow','rectangle'].includes(stroke.tool ?? '')) update([...latestGuides.current,stroke])
        }}
        onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke}
        onPointerLeave={()=>setCursor(null)}
        cursor={textTool||note?null:cursor} diameter={Math.max(6,size/1536*width)} erase={erase}/>
      {note && <div className="redline-note" role="group" aria-label="Annotation text" style={{
        left:Math.max(0,Math.min(note.point[0]*width,width-Math.min(260,width))),
        top:Math.max(0,Math.min(note.point[1]*height,height-124)),width:Math.min(260,width),
      }} onBlur={e=>{if (!e.currentTarget.contains(e.relatedTarget)) saveNote()}}>
        <textarea ref={noteInput} rows={3} maxLength={400} value={note.text} aria-label="Annotation text"
          placeholder="What should change here?" onChange={e=>editNote({...note,text:e.target.value})}
          onKeyDown={e=>{
            if (e.key==='Escape') { e.preventDefault();e.stopPropagation();editNote(null);layerButton.current?.focus() }
            if (e.key==='Enter'&&(e.metaKey||e.ctrlKey)) { e.preventDefault();saveNote();layerButton.current?.focus() }
          }}/>
        <div className="redline-note-actions">
          <button type="button" className="btn" onClick={()=>{editNote(null);layerButton.current?.focus()}}>Cancel</button>
          <button type="button" className="btn primary" disabled={!note.text.trim()} onClick={()=>{saveNote();layerButton.current?.focus()}}>Save note</button>
        </div>
      </div>}
    </>}
  </ImageStage>
}

function PaintCanvas({width,height,guides,visible,onPercent,cursor,diameter,erase,textTool,...events}:{
  width:number; height:number; guides:Guide[]; visible:boolean; onPercent:(n:number)=>void
  cursor:[number,number]|null; diameter:number; erase:boolean; textTool:boolean
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
    <canvas className={`ov paint-surface${textTool?' redline-text-tool':''}`} role="img" aria-label="Painting surface" ref={ref}
      width={Math.round(width*devicePixelRatio)} height={Math.round(height*devicePixelRatio)} {...events}/>
    {cursor && <span className={`cursor${erase?' erase':''}`} style={{
      left:cursor[0]*width,top:cursor[1]*height,width:diameter,height:diameter,
    }}/>}
  </>
}
