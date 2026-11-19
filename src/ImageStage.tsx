import {useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import type {Asset} from './model'

export function ImageStage({asset, source, tools, children, readout, panel, onClose, origin}:{
  asset:Asset
  source?:Asset
  tools:ReactNode
  children:(width:number,height:number)=>ReactNode
  readout:ReactNode
  panel?:ReactNode
  onClose:()=>void
  origin?:DOMRect
}) {
  const stage = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLDivElement>(null)
  const entered = useRef(false)
  const [width,setWidth] = useState(320)
  const ratio = asset.width/asset.height

  useLayoutEffect(() => {
    const el = stage.current!
    const box = el.closest('.focus')!
    const measure = () => {
      const narrow = box.clientWidth <= 640
      const availableW = box.clientWidth - 32 - (panel && !narrow ? 340 : 0)
      const availableH = Math.max(120,box.clientHeight - 92 - (toolbar.current?.offsetHeight ?? 36))
      setWidth(Math.max(100,Math.floor(Math.min(availableW, narrow ? availableW : availableH*ratio,1040))))
    }
    const resize = new ResizeObserver(measure)
    resize.observe(box)
    resize.observe(toolbar.current!)
    measure()
    return () => resize.disconnect()
  },[ratio,Boolean(panel)])

  useLayoutEffect(() => {
    if (entered.current || !origin || !figure.current || width === 320) return
    entered.current = true
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const to = figure.current!.getBoundingClientRect()
    figure.current!.animate([{
      transform:`translate(${origin.left-to.left}px,${origin.top-to.top}px) scale(${origin.width/to.width},${origin.height/to.height})`
    },{transform:'none'}],{duration:340,easing:'cubic-bezier(.2,.8,.2,1)'})
  },[origin,width])

  const height = Math.round(width/ratio)
  return <>
    <div className="scrim" onClick={onClose}/>
    <section className="focus" aria-label={panel ? 'Review image' : 'Edit image'}>
      <div className={`stage${panel ? ' is-review' : ''}`} ref={stage} onClick={(e) => e.currentTarget === e.target && onClose()}>
        <div className="figcol">
          <div ref={toolbar}>{tools}</div>
          <div className="fig" ref={figure} style={{width,height}}>
            <img className="stage-art" src={(source ?? asset).url} alt={(source ?? asset).name}/>
            {children(width,height)}
          </div>
          <p className="readout" aria-live="polite">{readout}</p>
        </div>
        {panel}
      </div>
    </section>
  </>
}
