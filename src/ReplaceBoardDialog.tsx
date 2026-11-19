import {useLayoutEffect,useRef,useState} from 'react'

type Props = {
  boardName:string
  filename:string
  onConfirm:()=>Promise<void>
  onClose:()=>void
}

export function ReplaceBoardDialog({boardName,filename,onConfirm,onClose}:Props) {
  const dialog=useRef<HTMLDialogElement>(null)
  const cancel=useRef<HTMLButtonElement>(null)
  const busy=useRef(false)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')

  useLayoutEffect(()=>{
    const element=dialog.current!
    const previous=document.activeElement
    element.showModal()
    cancel.current?.focus()
    return ()=>{
      element.close()
      if (previous instanceof HTMLElement) previous.focus({preventScroll:true})
    }
  },[])

  async function confirm() {
    if (busy.current) return
    busy.current=true
    setPending(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error?err.message:String(err))
    } finally {
      busy.current=false
      setPending(false)
    }
  }

  return <dialog className="run-dialog" ref={dialog} aria-labelledby="replace-board-title" aria-describedby="replace-board-description"
    onCancel={(event)=>{
      event.preventDefault()
      if (!busy.current) onClose()
    }}>
    <div className="rv-head"><div className="rv-title" id="replace-board-title">Replace board?</div></div>
    <div className="entry">
      <p id="replace-board-description">Opening <b>{filename}</b> will replace the contents, draft, and run history of <b>{boardName}</b>.</p>
    </div>
    {error&&<p className="workspace-menu-error" role="alert">{error}</p>}
    <div className="rv-foot">
      <button ref={cancel} type="button" className="btn" disabled={pending} onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" aria-disabled={pending||undefined} onClick={()=>void confirm()}>
        {pending?'Replacing…':'Replace board'}
      </button>
    </div>
  </dialog>
}
