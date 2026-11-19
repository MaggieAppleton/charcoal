import {Accordion} from '@base-ui/react/accordion'
import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {Icon} from './Icon.js'
import type {BoardList} from './client'
import './workspace-menu.css'

type Props = {
  catalogue:BoardList
  focusOnMount:boolean
  onSelect:(id:string)=>Promise<void>
  onCreate:(name:string)=>Promise<void>
  onRename:(name:string)=>Promise<void>
  onSetArchived:(id:string,archived:boolean)=>Promise<void>
  onRuns:()=>void
  onOpenProject:()=>void
  onExport:()=>void
}

export function WorkspaceMenu({catalogue,focusOnMount,onSelect,onCreate,onRename,onSetArchived,onRuns,onOpenProject,onExport}:Props) {
  const [open,setOpen]=useState(false)
  const [mode,setMode]=useState<'new'|'rename'|'archive'|null>(null)
  const [name,setName]=useState('')
  const [error,setError]=useState('')
  const [pending,setPending]=useState(false)
  const used=useRef(false)
  const box=useRef<HTMLDivElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  const active=useRef<HTMLButtonElement>(null)
  const input=useRef<HTMLInputElement>(null)
  const cancelArchive=useRef<HTMLButtonElement>(null)

  function dismiss(restoreFocus=false) {
    setOpen(false)
    setMode(null)
    setError('')
    if (restoreFocus) trigger.current?.focus({preventScroll:true})
  }

  useEffect(()=>{
    if (!open) return
    const pointer=(event:PointerEvent)=>{
      if (!box.current?.contains(event.target as Node)) dismiss()
    }
    const key=(event:KeyboardEvent)=>{
      if (event.key!=='Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (mode) {
        setMode(null)
        setError('')
      } else dismiss(true)
    }
    window.addEventListener('pointerdown',pointer)
    window.addEventListener('keydown',key)
    return ()=>{
      window.removeEventListener('pointerdown',pointer)
      window.removeEventListener('keydown',key)
    }
  },[open,mode])

  useEffect(()=>{
    if (focusOnMount) trigger.current?.focus({preventScroll:true})
  },[focusOnMount])

  useEffect(()=>{
    if (!open) return
    if (mode==='archive') cancelArchive.current?.focus()
    else if (mode) {input.current?.focus();input.current?.select()}
    else active.current?.focus()
  },[open,mode])

  function navigate(event:ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLButtonElement)) return
    const {key}=event
    if (key!=='ArrowUp'&&key!=='ArrowDown'&&key!=='Home'&&key!=='End') return
    const rows=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      .filter((button)=>!button.closest('[hidden],[inert],[data-ending-style]')&&button.getClientRects().length>0)
    const index=rows.indexOf(event.target)
    if (index<0) return
    const offset=key==='ArrowUp'?-1:1
    const next=key==='Home'?0:key==='End'?rows.length-1:(index+offset+rows.length)%rows.length
    event.preventDefault()
    event.stopPropagation()
    delete document.documentElement.dataset.modality
    rows[next]?.focus()
  }

  function rename() {
    setName(catalogue.boards.find(({id})=>id===catalogue.activeId)?.name??'')
    setMode('rename')
  }

  async function perform(action:()=>Promise<void>,close:boolean) {
    if (used.current) return
    used.current=true
    setPending(true)
    setError('')
    try {
      await action()
      if (close) dismiss(true)
      else setMode(null)
    } catch (err) {
      setError(err instanceof Error?err.message:String(err))
    } finally {
      used.current=false
      setPending(false)
    }
  }

  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value=name.trim()
    if (!value) return
    void perform(()=>mode==='rename'?onRename(value):onCreate(value),mode==='new')
  }

  const activeBoards=catalogue.boards.filter((board)=>!board.archived)
  const archivedBoards=catalogue.boards.filter((board)=>board.archived)
  const boardName=activeBoards.find(({id})=>id===catalogue.activeId)?.name ?? 'Workspace'

  return <div ref={box} className="workspace-menu">
    <button ref={trigger} className="btn workspace-switch" type="button" aria-label={`Workspace, ${boardName}`}
      aria-expanded={open} aria-controls="workspace-menu" data-tip="Workspace"
      onClick={()=>open?dismiss(true):setOpen(true)}><span>{boardName}</span><Icon name="chevDown"/></button>
    {open&&<div className="menu workspace-menu-content" id="workspace-menu" onKeyDownCapture={navigate}>
      <div role="group" aria-label="Boards">
        {activeBoards.map(({id,name})=>(
          <button key={id} className="workspace-board" type="button" title={name} disabled={pending}
            ref={id===catalogue.activeId?active:undefined} aria-current={id===catalogue.activeId?'true':undefined}
            onClick={()=>id===catalogue.activeId?dismiss(true):void perform(()=>onSelect(id),true)}>
            <span className="workspace-board-check" aria-hidden="true">{id===catalogue.activeId&&<Icon name="check"/>}</span>
            <span className="workspace-board-name">{name}</span>
          </button>
        ))}
      </div>
      {mode==='archive'?<div className="workspace-name-form">
        <p className="workspace-archive-copy">Archive <strong>{boardName}</strong>?</p>
        <div className="workspace-name-actions">
          <button type="button" className="btn primary" disabled={pending}
            onClick={()=>void perform(()=>onSetArchived(catalogue.activeId,true),true)}>Archive board</button>
          <button type="button" ref={cancelArchive} className="btn" disabled={pending}
            onClick={()=>{setMode(null);setError('')}}>Cancel</button>
        </div>
      </div>:mode?<form className="workspace-name-form" onSubmit={submit}>
        <label className="field-l" htmlFor="workspace-board-name">Board name</label>
        <input ref={input} id="workspace-board-name" value={name} required maxLength={80} onChange={(event)=>setName(event.target.value)}/>
        <div className="workspace-name-actions">
          <button type="submit" className="btn primary" disabled={pending||!name.trim()}>{mode==='new'?'Create board':'Save name'}</button>
          <button type="button" className="btn" disabled={pending} onClick={()=>{setMode(null);setError('')}}>Cancel</button>
        </div>
      </form>:<>
        <button type="button" disabled={pending} onClick={()=>{setName('');setMode('new')}}><Icon name="plus"/>New board</button>
        <button type="button" disabled={pending} onClick={rename}><Icon name="pen"/>Rename board</button>
        <button type="button" disabled={pending||activeBoards.length<2} onClick={()=>setMode('archive')}>
          <Icon name="x"/>Archive board
        </button>
        {archivedBoards.length>0&&<Accordion.Root>
          <Accordion.Item value="archive">
            <Accordion.Header className="workspace-archive-heading">
              <Accordion.Trigger disabled={pending}>
                <Icon name="doc"/><span className="workspace-board-name">Archived boards</span>
                <span className="muted">{archivedBoards.length}</span><Icon name="chevRight"/>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="disclosure-panel">
              {archivedBoards.map(({id,name})=>(
                <button key={id} type="button" title={name} aria-label={`Restore ${name}`} disabled={pending}
                  onClick={()=>void perform(()=>onSetArchived(id,false),true)}>
                  <Icon name="undo"/><span className="workspace-board-name">{name}</span><span className="muted">Restore</span>
                </button>
              ))}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion.Root>}
      </>}
      {error&&<div className="workspace-menu-error" role="alert">{error}</div>}
      <div className="workspace-project-actions" role="group" aria-label="Project">
        <button type="button" onClick={()=>{dismiss(true);onRuns()}}><Icon name="doc"/>Runs</button>
        <button type="button" onClick={()=>{dismiss(true);onOpenProject()}}><Icon name="plus"/>Open project</button>
        <button type="button" onClick={()=>{dismiss(true);onExport()}}><Icon name="download"/>Export project</button>
      </div>
    </div>}
  </div>
}
