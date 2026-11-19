import {useEffect,type RefObject} from 'react'

export function Tooltip({frame}:{frame:RefObject<HTMLElement|null>}) {
  useEffect(()=>{
    const node=frame.current
    if (!node) return
    const tip=document.createElement('div')
    tip.className='tip'
    tip.setAttribute('role','tooltip')
    tip.hidden=true
    node.append(tip)
    let active:HTMLElement|null=null
    let timer=0
    function hide() {
      window.clearTimeout(timer)
      active=null
      tip.hidden=true
    }
    function show(event:Event) {
      const trigger=(event.target as Element)?.closest<HTMLElement>('[data-tip]')
      if (!trigger?.dataset.tip) { hide(); return }
      if (trigger===active) return
      hide()
      active=trigger
      timer=window.setTimeout(()=>{
        if (!trigger.isConnected) return
        tip.textContent=trigger.dataset.tip!
        tip.hidden=false
        const bounds=node!.getBoundingClientRect()
        const r=trigger.getBoundingClientRect()
        if (trigger.dataset.tipSide==='right') {
          tip.style.left=Math.min(r.right-bounds.left+6,bounds.width-tip.offsetWidth-8)+'px'
          tip.style.top=Math.max(8,r.top-bounds.top+(r.height-tip.offsetHeight)/2)+'px'
          return
        }
        const x=r.left-bounds.left+(r.width-tip.offsetWidth)/2
        const y=r.top-bounds.top-tip.offsetHeight-6
        tip.style.left=Math.max(8,Math.min(x,bounds.width-tip.offsetWidth-8))+'px'
        tip.style.top=(y<4?r.bottom-bounds.top+6:y)+'px'
      },380)
    }
    function pointer(event:PointerEvent) {
      if(event.pointerType==='mouse') show(event)
    }
    function focus(event:FocusEvent) {
      if(document.documentElement.dataset.modality!=='pointer') show(event)
    }
    node.addEventListener('pointerover',pointer)
    node.addEventListener('pointerdown',hide)
    node.addEventListener('pointerleave',hide)
    node.addEventListener('focusin',focus)
    node.addEventListener('focusout',hide)
    return ()=>{
      hide()
      tip.remove()
      node.removeEventListener('pointerover',pointer)
      node.removeEventListener('pointerdown',hide)
      node.removeEventListener('pointerleave',hide)
      node.removeEventListener('focusin',focus)
      node.removeEventListener('focusout',hide)
    }
  },[frame])
  return null
}
