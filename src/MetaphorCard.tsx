import {Icon} from './Icon.js'
import './metaphor-card.css'

export type MetaphorOption = {title:string;scene:string;meaning:string;caveat:string}
type MetaphorRequestPayload = {context:string} & (
  {count?:3;option?:never;feedback?:never;exclusions?:never} |
  {count:1;exclusions:MetaphorOption[];option?:never;feedback?:never} |
  {option:MetaphorOption;feedback:string;count?:never;exclusions?:never}
)
export type MetaphorRequest = {id:string} & (
  {payload:MetaphorRequestPayload;fingerprint?:never} |
  {fingerprint:string;payload?:never}
)
export type {MetaphorRequestPayload}
export type ArticleSource = {url:string;title:string}
export type MetaphorData = {
  kind:'brief'|'option'
  title:string
  context:string
  article?:ArticleSource
  scene?:string
  meaning?:string
  caveat?:string
  briefId?:string
  feedback?:string
  lastRefinement?:string
  history?:MetaphorOption[]
  promptId?:string
  explored?:boolean
  dismissedOptions?:Record<string,MetaphorOption>
  request?:MetaphorRequest
}

export type MetaphorStatus = {busy?:boolean;error?:string}

export function MetaphorCard({id,data,selected,status,onOpen}:{
  id:string
  data:MetaphorData
  selected:boolean
  status?:MetaphorStatus
  onOpen:()=>void
}) {
  const brief=data.kind==='brief'
  const title=data.title.trim()||(brief?'Illustration brief':'Metaphor option')
  return <button type="button" className="metaphor-card" data-board-metaphor={id} data-kind={data.kind}
    aria-label={brief?`Open brief: ${title}`:`Open metaphor: ${title}`} aria-pressed={selected}
    aria-keyshortcuts={brief?'ArrowUp ArrowDown ArrowLeft ArrowRight':'ArrowUp ArrowDown ArrowLeft ArrowRight Delete'} aria-busy={status?.busy} onClick={event=>{if(event.detail===0)onOpen()}}>
    <span className="metaphor-card-heading">
      {brief&&<Icon name="doc"/>}<strong>{title}</strong>
      {status?.busy&&<span className="composer-generation-indicator" aria-hidden="true"/>}
      {status?.error&&<Icon name="alertCircle"/>}
    </span>
    {!brief&&<span className="metaphor-excerpt">{data.scene}</span>}
  </button>
}
