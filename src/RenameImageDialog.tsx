import {useId,useLayoutEffect,useRef,useState,type FormEvent} from 'react'

type Props = {
  name:string
  trigger:HTMLButtonElement
  onSave:(name:string)=>Promise<void>
  onClose:()=>void
}

export function RenameImageDialog({name,trigger,onSave,onClose}:Props) {
  const titleId=useId()
  const inputId=useId()
  const errorId=useId()
  const dialog=useRef<HTMLDialogElement>(null)
  const input=useRef<HTMLInputElement>(null)
  const busy=useRef(false)
  const [value,setValue]=useState(name)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')

  useLayoutEffect(()=>{
    const element=dialog.current!
    element.showModal()
    input.current?.focus()
    input.current?.select()
    return ()=>{
      element.close()
      trigger.focus({preventScroll:true})
    }
  },[trigger])

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const next=value.trim()
    if (!next) {
      setError('Enter an image name.')
      input.current?.focus()
      return
    }
    if (next===name) {
      onClose()
      return
    }
    busy.current=true
    setPending(true)
    setError('')
    try {
      await onSave(next)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error?reason.message:'Could not rename the image.')
      input.current?.focus()
    } finally {
      busy.current=false
      setPending(false)
    }
  }

  return <dialog className="run-dialog" ref={dialog} aria-labelledby={titleId}
    onCancel={(event)=>{event.preventDefault();if (!busy.current) onClose()}}>
    <form className="rename-image-form" onSubmit={submit}>
      <div className="rv-head"><h2 className="rv-title" id={titleId}>Rename image</h2></div>
      <div className="entry">
        <label className="field-l" htmlFor={inputId}>Image name</label>
        <input type="text" id={inputId} ref={input} value={value} maxLength={180} readOnly={pending}
          aria-invalid={!!error} aria-describedby={error?errorId:undefined} onChange={(event)=>{setValue(event.target.value);setError('')}}/>
        {error&&<p className="rename-image-error" id={errorId} role="alert">{error}</p>}
      </div>
      <div className="rv-foot">
        <button type="button" className="btn" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" aria-disabled={pending||undefined} aria-busy={pending||undefined}>Save name</button>
      </div>
    </form>
  </dialog>
}
