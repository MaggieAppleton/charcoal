import type {Asset,Boot,Run,Workspace} from './model'
import type {CandidateAction} from './Review'
import {decodePromptBlocks,encodePromptBlocks} from './prompt-blocks'

export type BoardInfo = {id:string;name:string;archived?:boolean}
export type BoardList = {activeId:string;boards:BoardInfo[]}

async function request<T>(url:string,init?:RequestInit):Promise<T> {
  const response = await fetch(url,init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Charcoal could not complete the request.')
  return data
}

function json(method:string,value:unknown):RequestInit {
  return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}
}

export type ProviderStatus = {provider:Boot['provider'];sessionKey:boolean}

export const providerCredentials = {
  save:(apiKey:string)=>request<ProviderStatus>('/api/provider-key',json('POST',{apiKey})),
  clear:()=>request<ProviderStatus>('/api/provider-key',{method:'DELETE'}),
}

export const boardCatalogue = {
  list:()=>request<BoardList>('/api/boards'),
  create:(name:string)=>request<BoardInfo>('/api/boards',json('POST',{name})),
  activate:(id:string)=>request<BoardList>(`/api/boards/${encodeURIComponent(id)}`,json('PATCH',{active:true})),
  rename:(id:string,name:string)=>request<BoardList>(`/api/boards/${encodeURIComponent(id)}`,json('PATCH',{name})),
  setArchived:(id:string,archived:boolean)=>request<BoardList>(`/api/boards/${encodeURIComponent(id)}`,json('PATCH',{archived})),
}

export function boardClient(id:string) {
  const path = (route:string)=>`/api${route}${route.includes('?')?'&':'?'}board=${encodeURIComponent(id)}`
  return {
    boot:()=>request<Boot>(path('/state')).then(decodePromptBlocks),
    runs:()=>request<Pick<Boot,'runs'|'assets'>>(path('/runs')),
    save:(w:Workspace)=>request(path('/workspace'),json('PUT',encodePromptBlocks(w))),
    upload:(file:File)=>request<Asset>(path('/assets?name='+encodeURIComponent(file.name)),{method:'POST',body:file}),
    renameAsset:(assetId:string,name:string)=>request<Asset>(path(`/assets/${encodeURIComponent(assetId)}`),json('PATCH',{name})),
    importArticle:(url:string)=>request<import('./MetaphorCard').ArticleSource & {text:string}>(path('/article'),json('POST',{url})),
    exploreMetaphors:(draft:unknown)=>request<{options:{title:string;scene:string;meaning:string;caveat:string}[]}>(path('/metaphors'),json('POST',draft)),
    recoverPlan:(batchId:string)=>request<{plan:import('./composition-plan.js').CompositionPlan|null}>(
      path('/composition-plans?id='+encodeURIComponent(batchId))).then(({plan})=>plan),
    planCompositions:(draft:unknown)=>request<import('./composition-plan.js').CompositionPlan>(path('/composition-plans'),json('POST',draft)),
    submit:(draft:unknown)=>request<Run>(path('/runs'),json('POST',draft)),
    retry:(run:Run,confirmed:boolean)=>request<Run>(path(`/runs/${run.id}/retry`),json('POST',{id:crypto.randomUUID(),confirmed})),
    candidate:(runId:string,id:string,action:CandidateAction)=>request(path(`/runs/${runId}/candidates/${id}`),json('PATCH',action)),
    reOpen:(file:File)=>request<Boot>(path('/project'),{method:'POST',headers:{'Content-Type':'application/json'},body:file}).then(decodePromptBlocks),
    exportUrl:path('/project'),
  }
}
