import {useEffect,useId,useRef,type RefObject} from 'react'
import {Icon} from './Icon.js'
import type {Asset} from './model'
import './pinned-images.css'

export function PinIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3h8M9 3v6l-4 5v2h14v-2l-4-5V3M12 16v6" />
  </svg>
}

export function PinnedImages({assets,onUnpin,onRefine,onLocate,onClose,triggerRef}:{
  assets:Asset[]
  onUnpin:(id:string)=>void
  onRefine:(id:string)=>void
  onLocate:(id:string)=>void
  onClose:()=>void
  triggerRef?:RefObject<HTMLButtonElement|null>
}) {
  const title = useId()
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  function dismiss() {
    close.current()
    triggerRef?.current?.focus({preventScroll:true})
  }

  useEffect(() => {
    const trigger = triggerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    panel.current?.querySelector<HTMLButtonElement>('.pinned-image-open')?.focus({preventScroll:true})
    if (!assets.length) closeButton.current?.focus({preventScroll:true})
    function escape(event:KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"]')) return
      event.preventDefault()
      event.stopPropagation()
      close.current()
      trigger?.focus({preventScroll:true})
    }
    document.addEventListener('keydown',escape)
    return () => document.removeEventListener('keydown',escape)
    // Opening establishes focus; pin changes should not move it.
  },[triggerRef])

  function unpin(id:string,button:HTMLButtonElement) {
    const row = button.closest('li')
    const next = row?.nextElementSibling ?? row?.previousElementSibling
    const focus = next?.querySelector<HTMLButtonElement>('.pinned-image-open') ?? closeButton.current
    focus?.focus({preventScroll:true})
    onUnpin(id)
  }

  return <section className="pinned-images" ref={panel} aria-labelledby={title}>
    <div className="pinned-images-header">
      <h2 id={title}><PinIcon />Pinned images</h2>
      <button type="button" className="btn icon" ref={closeButton} aria-label="Close pinned images"
        data-tip="Close pinned images" onClick={dismiss}><Icon name="x" /></button>
    </div>
    {assets.length ? <ul className="pinned-images-list">
      {assets.map(asset => <li key={asset.id} data-pinned-id={asset.id}>
        <button type="button" className="pinned-image-open" aria-label={`Refine ${asset.name}`} onClick={()=>onRefine(asset.id)}>
          <img src={asset.url} alt="" loading="lazy" decoding="async" draggable={false} />
          <span>{asset.name}</span>
        </button>
        <div className="pinned-image-actions">
          <button type="button" className="btn" onClick={()=>onLocate(asset.id)} aria-label={`Find ${asset.name} on canvas`}>On canvas</button>
          <span className="pinned-actions-space" />
          <a className="btn icon" href={asset.originalUrl} download={asset.name} aria-label={`Download ${asset.name}`} data-tip="Download image"><Icon name="download" /></a>
          <button type="button" className="btn icon" aria-label={`Unpin ${asset.name}`} data-tip="Unpin image" aria-pressed="true"
            onClick={event=>unpin(asset.id,event.currentTarget)}><PinIcon /></button>
        </div>
      </li>)}
    </ul> : <p className="pinned-images-empty">Pin promising images from their canvas toolbar.</p>}
  </section>
}
