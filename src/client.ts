import type {Asset,Boot,Run,Workspace} from './model'
import type {CandidateAction} from './Review'

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
    boot:()=>request<Boot>(path('/state')),
    runs:()=>request<Pick<Boot,'runs'|'assets'>>(path('/runs')),
    save:(w:Workspace)=>request(path('/workspace'),json('PUT',w)),
    upload:(file:File)=>request<Asset>(path('/assets?name='+encodeURIComponent(file.name)),{method:'POST',body:file}),
    renameAsset:(assetId:string,name:string)=>request<Asset>(path(`/assets/${encodeURIComponent(assetId)}`),json('PATCH',{name})),
    submit:(draft:unknown)=>request<Run>(path('/runs'),json('POST',draft)),
    retry:(run:Run,confirmed:boolean)=>request<Run>(path(`/runs/${run.id}/retry`),json('POST',{id:crypto.randomUUID(),confirmed})),
    candidate:(runId:string,id:string,action:CandidateAction)=>request(path(`/runs/${runId}/candidates/${id}`),json('PATCH',action)),
    reOpen:(file:File)=>request<Boot>(path('/project'),{method:'POST',headers:{'Content-Type':'application/json'},body:file}),
    exportUrl:path('/project'),
  }
}
