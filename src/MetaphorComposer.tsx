import { useRef, type ReactNode } from 'react'
import type { ArticleSource, MetaphorData, MetaphorStatus } from './MetaphorCard'
import { Icon } from './Icon.js'

export type MetaphorComposerProps = {
  data?: MetaphorData
  context: string
  article?: ArticleSource
  articleImport?: {
    input: string | null
    status: MetaphorStatus
    onInput: (value: string | null) => void
    onImport: () => void
  }
  status?: MetaphorStatus
  optionCount: number
  canAppend: boolean
  pendingRequest: boolean
  sourceAvailable: boolean
  hasPrompt: boolean
  onEdit: (patch: Partial<MetaphorData>) => void
  onContext: (context: string) => void
  onClear: () => void
  onSubmit: () => void
  onDraft: () => void
  onSource: () => void
  onLocate: () => void
  onAdd: () => void
  onRestart: () => void
  onDelete: () => void
  onPrompt: () => void
}

export function MetaphorComposer({data,context,article,articleImport,status,optionCount,canAppend,pendingRequest,sourceAvailable,hasPrompt,
  onEdit,onContext,onClear,onSubmit,onDraft,onSource,onLocate,onAdd,onRestart,onDelete,onPrompt,modeButton}:MetaphorComposerProps & {modeButton:ReactNode}) {
  const field=useRef<HTMLTextAreaElement>(null)
  const option=data?.kind==='option'
  const busy=!!status?.busy
  const importing=!!articleImport?.status.busy
  const feedback=data?.feedback?.trim()
  const clearable=option ? !!data.feedback : !data && !!(context||article||articleImport?.input!=null)
  const clearLabel=option?'Clear feedback':'Clear brief draft'
  const canRefine=option && !!feedback && feedback!==data.lastRefinement && !!data.scene?.trim() &&
    !!data.title.trim() && !!data.meaning?.trim()
  const ready=option ? pendingRequest||canRefine : !!context.trim() && !canAppend
  const action=pendingRequest&&!busy ? 'Recover request' : option?'Refine':'Explore metaphors'
  const addLabel=pendingRequest&&!busy?'Recover metaphor request':'Add metaphor option'
  return <form className="metaphor-composer" noValidate onSubmit={event=>{
    event.preventDefault()
    if(ready&&!busy&&!importing)onSubmit()
  }} onKeyDown={event=>{
    if(event.key==='Enter' && (event.metaKey||event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if(ready&&!busy&&!importing)onSubmit()
    }
  }}>
    {data&&<div className="metaphor-composer-heading">
      <input type="text" aria-label={option?'Metaphor title':'Brief title'} value={data.title} maxLength={8000}
        disabled={busy} onChange={event=>onEdit({title:event.target.value,lastRefinement:undefined})}/>
      {option&&<button type="button" className="btn icon" aria-label="Delete metaphor option"
        data-tip="Delete metaphor option" onClick={onDelete}><Icon name="trash"/></button>}
      {sourceAvailable&&<button type="button" className="btn icon" aria-label="Open source brief" data-tip="Source brief" onClick={onSource}><Icon name="doc"/></button>}
      <button type="button" className="btn icon" aria-label="Return to brief draft" data-tip="Brief draft" onClick={onDraft}><Icon name="x"/></button>
    </div>}
    {option&&<div className="metaphor-composer-detail">
      <textarea rows={3} className="metaphor-scene" aria-label="Metaphor scene" maxLength={8000}
        value={data.scene??''} disabled={busy} onChange={event=>onEdit({scene:event.target.value,lastRefinement:undefined})}/>
      {data.meaning&&<p>{data.meaning}</p>}
      {data.caveat&&<p><strong>Watch for</strong> {data.caveat}</p>}
    </div>}
    {article&&<a className="btn lead brief-source-link" href={article.url} target="_blank" rel="noreferrer"
      title={article.url}><Icon name="link"/><span>{article.title}</span></a>}
    {articleImport&&articleImport.input!==null&&<div className="metaphor-article-row">
      <input type="url" aria-label="Post link" value={articleImport.input} placeholder="https://" maxLength={2048}
        disabled={importing} onChange={event=>articleImport.onInput(event.target.value)}
        onKeyDown={event=>{
          if(event.key==='Enter'&&!event.nativeEvent.isComposing) {
            event.preventDefault();event.stopPropagation();articleImport.onImport()
          }
        }}/>
      <button type="button" className="btn" disabled={importing||!articleImport.input.trim()}
        onClick={articleImport.onImport}>{importing?'Importing…':'Import text'}</button>
    </div>}
    {articleImport?.status.error&&<p className="composer-status metaphor-error" role="alert">{articleImport.status.error}</p>}
    {option
      ? <textarea ref={field} id="metaphor-input" rows={2} aria-label="Metaphor feedback" maxLength={8000} value={data.feedback??''}
        disabled={busy} placeholder="What would you change?" onChange={event=>onEdit({feedback:event.target.value})}/>
      : <textarea ref={field} id="metaphor-input" rows={3} aria-label="Brief context" maxLength={100000} value={context}
        readOnly={data?.kind==='brief'&&(canAppend||pendingRequest)} placeholder="Paste the context for an illustration" onChange={event=>onContext(event.target.value)}/>}
    {status?.error&&<div className="composer-status metaphor-error">
      <span role="alert">{status.error}</span>
      {pendingRequest&&<button type="button" className="btn" disabled={option&&!canRefine} onClick={onRestart}>Start new request</button>}
    </div>}
    <div className="bar">
      {modeButton}
      {articleImport&&<button type="button" className="btn icon" aria-label="Import a post link" data-tip="Import a post link"
        aria-expanded={articleImport.input!==null} disabled={importing} onClick={()=>{
          const open=articleImport.input===null
          articleImport.onInput(open?'':null)
          if(open)requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.metaphor-article-row input')?.focus())
        }}><Icon name="link"/></button>}
      <span className="spacer"/>
      {busy&&<span className="composer-generation-indicator" role="status" aria-label={option?'Refining metaphor':'Exploring metaphors'}/>}
      {canAppend&&<span className="metaphor-option-actions">
        {optionCount>0&&<button type="button" className="btn" onClick={onLocate}>View options <Icon name="arrowRight"/></button>}
        <button type="button" className="btn icon" aria-label={addLabel} data-tip={addLabel}
          aria-disabled={busy||importing} aria-busy={busy} onClick={()=>{if(!busy&&!importing)onAdd()}}>
          <Icon name="plus"/>
        </button>
      </span>}
      {option&&<button type="button" className="btn" disabled={busy||!data.scene?.trim()} onClick={onPrompt}>
        {hasPrompt?'View prompt':'Use as prompt'}
      </button>}
      {clearable&&<button type="button" className="btn icon" aria-label={clearLabel} data-tip={clearLabel}
        disabled={importing||(option&&busy)} onClick={()=>{onClear();field.current?.focus({preventScroll:true})}}>
        <Icon name="eraser"/>
      </button>}
      {(option||!canAppend)&&<button type="submit" className="btn primary" aria-busy={busy} disabled={!ready||busy||importing}>
        {action}
      </button>}
    </div>
  </form>
}
