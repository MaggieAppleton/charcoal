import {useLayoutEffect,useRef,useState} from 'react'
import {Icon} from './Icon.js'
import type {Asset,Run} from './model'

function status(run:Run) {
  return {pending:'Generating…',done:'Ready',failed:'Failed',uncertain:'Interrupted'}[run.status]
}

export function RunDialog({value,runs,assets,onOpen,onClose,onRetry,onReview}:{
  value:string; runs:Run[]; assets:Asset[]
  onOpen:(id:string)=>void; onClose:()=>void
  onRetry:(run:Run,confirmed:boolean)=>void; onReview:(id:string)=>void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [confirmed,setConfirmed] = useState(false)
  useLayoutEffect(()=>{dialog.current?.showModal()},[])
  const run = runs.find((r)=>r.id===value)
  const confirm = run?.status === 'uncertain' || run?.retryNeedsConfirmation
  const close = <button type="button" className="btn icon" aria-label="Close run record" onClick={onClose}><Icon name="x"/></button>
  const asset = (id:string) => assets.find((a)=>a.id===id)
  return <dialog className="run-dialog" ref={dialog} onCancel={onClose}
    onClick={(e)=>e.target===e.currentTarget&&onClose()} aria-label={run?'Run record':'Runs'}>
    <div className="rv-head"><div className="rv-title">{run?'Run record':'Runs'}</div>{close}</div>
    {run ? <>
      <div className="entry"><b>{status(run)}</b><p className="muted">{run.error ?? (run.provider==='fixture'?'Browser fixture':'Sunburst 2.6')}</p></div>
      <div className="entry"><b>Full prompt</b><p className="muted">{run.effectivePrompt}</p></div>
      <div className="entry"><b>Settings</b><p>{run.settings.quality} quality, {run.settings.complexity.toLowerCase()} complexity, {run.settings.size.toLowerCase()}, {run.settings.count} {run.settings.count==='1'?'variation':'variations'}</p>
        {!!run.inputs.length && <ol>{run.inputs.map((id)=><li key={id}>{asset(id)?.name??id}</li>)}</ol>}</div>
      {run.style && <div className="entry"><b>{run.style.name} · Version {run.style.version}</b>
        {run.reviewer && <p className="muted">{run.reviewer.model}. {run.reviewer.instruction}</p>}
        {run.style.rules.map((rule)=><div key={rule.id}><b>{rule.title}</b><p className="muted">{rule.check || rule.prompt}</p></div>)}</div>}
      {run.usage !== undefined && <div className="entry"><b>Provider usage</b><p className="muted">{JSON.stringify(run.usage,null,2)}</p></div>}
      {(run.rawIds ?? run.candidates.map((c)=>c.rawId)).map((id,i)=>
        <div className="entry" key={id}><a className="link" href={asset(id)?.originalUrl} download>Download raw response {i+1}</a></div>)}
      {run.candidates.map((candidate)=><button key={candidate.id} className="btn run-list-row" onClick={()=>onReview(candidate.id)}>
        <Icon name="checkCircle"/><span>{asset(candidate.id)?.name}</span></button>)}
      {['failed','uncertain'].includes(run.status) && <div className="entry">
        {confirm && <p><label><input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)}/> I accept a possible additional charge</label></p>}
        <button className="btn primary" disabled={confirm&&!confirmed} onClick={()=>{onRetry(run,confirmed);setConfirmed(false)}}>Retry generation</button>
      </div>}
      <div className="rv-foot"><button className="btn" onClick={()=>onOpen('all')}>All runs</button></div>
    </> : runs.length ? [...runs].reverse().map((r)=>
      <button key={r.id} className="btn run-list-row" onClick={()=>onOpen(r.id)}><span>{r.label}</span><span className="muted">{status(r)}</span></button>
    ) : <div className="entry muted">No runs yet</div>}
  </dialog>
}
