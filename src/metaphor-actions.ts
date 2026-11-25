import type {BoardSession} from './board-session'
import type {BoardMark, Rect} from './board-geometry'
import type {MetaphorData, MetaphorOption, MetaphorRequest, MetaphorRequestPayload} from './MetaphorCard'
import {markRect} from './board-marks'
import {briefLocation, optionLocations, promptLocation} from './metaphor-layout'
import {candidatePositions} from './workspace'
import {normalizeMetaphorScene} from './metaphor-scenes.js'

const optionOf=(data:MetaphorData):MetaphorOption=>({title:data.title,scene:data.scene??'',meaning:data.meaning??'',caveat:data.caveat??''})
const briefTitle=(context:string)=>context.trim().split('\n')[0].trim().replace(/\s+/g,' ').slice(0,80)

type Placement = {view:Rect;obstacles:Rect[]}

function optionsFor(marks:BoardMark[], briefId:string) {
  return marks.flatMap(mark=>mark.metaphor?.kind==='option'&&mark.metaphor.briefId===briefId?[mark.metaphor]:[])
}

export function briefExplored(data:MetaphorData,optionCount:number) {
  return !!(data.explored||optionCount||Object.keys(data.dismissedOptions??{}).length)
}

function exclusionsFor(data:MetaphorData,options:MetaphorData[]) {
  return [...options.map(optionOf),...Object.values(data.dismissedOptions??{})]
}

function sceneAvailable(mark:BoardMark,annotations:BoardMark[]) {
  const data=mark.metaphor
  if(data?.kind!=='option'||!data.briefId||!data.scene)return true
  const scene=normalizeMetaphorScene(data.scene)
  const brief=annotations.find(current=>current.id===data.briefId)?.metaphor
  const options=optionsFor(annotations.filter(current=>current.id!==mark.id),data.briefId).map(optionOf)
  const dismissed=Object.entries(brief?.dismissedOptions??{}).filter(([id])=>id!==mark.id).map(([,option])=>option)
  return ![...options,...dismissed].some(option=>normalizeMetaphorScene(option.scene)===scene)
}

function canRestore(mark:BoardMark,annotations:BoardMark[]) {
  return !annotations.some(current=>current.id===mark.id) && sceneAvailable(mark,annotations)
}

function savedPayload(request:MetaphorRequest):MetaphorRequestPayload {
  return request.payload??JSON.parse(request.fingerprint)
}

function sameOption(data:MetaphorData,option:MetaphorOption) {
  return data.title===option.title && data.scene===option.scene &&
    (data.meaning??'')===option.meaning && (data.caveat??'')===option.caveat
}

function matchesRequest(data:MetaphorData,payload:MetaphorRequestPayload) {
  return data.context===payload.context && (!payload.option ||
    (sameOption(data,payload.option) && data.feedback?.trim()===payload.feedback))
}

// History owns detached cards. Only in-flight requests need to find them
// independently, so a completion can update the card without making it visible.
type DetachedCard = {mark:BoardMark}
const detachedCards=new WeakMap<BoardSession,Map<string,DetachedCard>>()

export function metaphorActions(session:BoardSession, placement:()=>Placement|undefined) {
  const {record,redoMarks}=session.history
  const update=session.setWorkspace
  const snapshot=session.snapshot
  let detached=detachedCards.get(session)
  if(!detached)detachedCards.set(session,detached=new Map())
  const removed=detached

  function detach(mark:BoardMark) {
    const entry={mark}
    if(snapshot().metaphorStatus[mark.id]?.busy)removed.set(mark.id,entry)
    return entry
  }

  function restore(entry:DetachedCard) {
    if(removed.get(entry.mark.id)===entry)removed.delete(entry.mark.id)
    return entry.mark
  }

  function appendExclusions(data:MetaphorData,id:string) {
    const options=optionsFor([...snapshot().workspace.annotations,...redoMarks()],id)
    return [...new Map(exclusionsFor(data,options).map(option=>[normalizeMetaphorScene(option.scene),option])).values()]
  }

  function obstacles(fallback?:Placement) {
    const {workspace:w,boot:{runs,assets},submissions}=snapshot()
    const positions=candidatePositions(runs,assets,w.positions)
    const deleted=new Set(w.deletedImageIds)
    return [
      ...(placement()??fallback)?.obstacles??[],
      ...Object.entries(positions).flatMap(([id,rect])=>deleted.has(id)?[]:[rect]),
      ...submissions.filter(job=>job.status==='pending').map(job=>job.rect),
      ...w.annotations.map(markRect),
    ]
  }

  function edit(id:string, patch:Partial<MetaphorData>) {
    const apply=(mark:BoardMark)=>{
      if(mark.id!==id||!mark.metaphor)return mark
      const metaphor={...mark.metaphor,...patch}
      if(metaphor.request && !Object.hasOwn(patch,'request')) {
        const previous=mark.metaphor
        if(previous.context!==metaphor.context || (metaphor.kind==='option' &&
          (!sameOption(metaphor,optionOf(previous)) || previous.feedback?.trim()!==metaphor.feedback?.trim()))) {
          metaphor.request=undefined
        }
      }
      return {...mark,metaphor,text:metaphor.kind==='brief'?metaphor.context:metaphor.scene}
    }
    const hidden=removed.get(id)
    if(hidden)hidden.mark=apply(hidden.mark)
    update(w=>w.annotations.some(mark=>mark.id===id)?{...w,annotations:w.annotations.map(apply)}:w)
  }

  function submitDraft() {
    const {workspace:w}=snapshot()
    const draft=w.metaphorDraft
    if(session.projectOpening()||!draft?.context.trim())return
    const previous=w.annotations.find(mark=>mark.id===draft.briefId)?.metaphor
    if(previous?.context===draft.context && draft.briefId) {
      void explore(draft.briefId)
      return
    }
    const id=crypto.randomUUID()
    const view=placement()?.view??{x:72,y:52,width:640,height:460}
    const start=briefLocation(view,obstacles())
    const data:MetaphorData={kind:'brief',title:draft.article?.title||briefTitle(draft.context),context:draft.context,article:draft.article}
    const mark:BoardMark={id,kind:'note',text:data.context,points:[start],metaphor:data}
    update(current=>({...current,metaphorDraft:{...draft,briefId:id},annotations:[...current.annotations,mark]}))
    void explore(id)
  }

  async function explore(id:string, startFresh=false) {
    const {workspace:w,metaphorStatus}=snapshot()
    if(session.projectOpening()||metaphorStatus[id]?.busy)return
    const data=w.annotations.find(mark=>mark.id===id)?.metaphor
    if(!data?.context.trim())return
    const refining=data.kind==='option'
    let request=startFresh?undefined:data.request
    const cacheOnly=!!request
    if(!request) {
      let payload:MetaphorRequestPayload
      if(refining) {
        const feedback=data.feedback?.trim()
        if(!feedback||feedback===data.lastRefinement||!data.scene?.trim()||!data.title.trim()||!data.meaning?.trim())return
        payload={context:data.context,option:optionOf(data),feedback}
      } else {
        const options=optionsFor(w.annotations,id)
        payload=briefExplored(data,options.length)
          ? {context:data.context,count:1,exclusions:appendExclusions(data,id)}
          : {context:data.context,count:3}
      }
      request={id:crypto.randomUUID(),payload}
    }
    const requestId=request.id
    const startPlacement=placement()
    session.setMetaphorStatus(id,{busy:true})
    if(!cacheOnly)edit(id,{request})
    let errorMessage:string|undefined
    try {
      const payload=savedPayload(request)
      if(!matchesRequest(data,payload)) {
        edit(id,{request:undefined})
        return
      }
      await session.flush()
      const result=await session.client.exploreMetaphors({...payload,id:requestId,cacheOnly})
      const visible=snapshot().workspace.annotations.find(mark=>mark.id===id)
      const current=visible??removed.get(id)?.mark
      if(current?.metaphor?.request?.id!==requestId || !matchesRequest(current.metaphor,payload))return
      if(refining) {
        if(!payload.option)throw new Error('This request does not contain a refinement.')
        const before=current.metaphor
        const next={...result.options[0],lastRefinement:payload.feedback,request:undefined,
          history:[...(before.history??[]),payload.option].slice(-20)}
        if(!sceneAvailable({...current,metaphor:{...before,...next}},snapshot().workspace.annotations))
          throw new Error('The metaphor agent repeated an option from this brief.')
        edit(id,next)
        const original={...optionOf(before),history:before.history,lastRefinement:before.lastRefinement,request}
        function replay(expected:MetaphorOption,patch:typeof original|typeof next) {
          const annotations=snapshot().workspace.annotations
          const mark=annotations.find(mark=>mark.id===id)??removed.get(id)?.mark
          if(!mark?.metaphor || (mark.metaphor.request && mark.metaphor.request.id!==requestId) || !sameOption(mark.metaphor,expected) ||
            mark.metaphor.feedback?.trim()!==payload.feedback)return
          const candidate={...mark,metaphor:{...mark.metaphor,...patch}}
          if(!sceneAvailable(candidate,annotations))return
          edit(id,patch)
        }
        if(visible)record({undo:()=>replay(next,original),redo:()=>replay(original,next),
          redoMarks:()=>[{...visible,metaphor:{...before,...next}}]},true)
      } else {
        // A deleted brief can still recover the durable result after undo.
        if(!visible)return
        if(payload.count===1) {
          const latest=appendExclusions(current.metaphor,id)
          const scene=normalizeMetaphorScene(result.options[0].scene)
          if(latest.some(option=>normalizeMetaphorScene(option.scene)===scene))
            throw new Error('The metaphor agent repeated an option from this brief.')
        }
        const points=optionLocations(markRect(current),result.options.length,obstacles(startPlacement),
          (placement()??startPlacement)?.view)
        const cards:BoardMark[]=result.options.map((option,index)=>({
          id:`${requestId}-${index}`,kind:'note',text:option.scene,points:[points[index]],
          metaphor:{kind:'option',briefId:id,context:payload.context,article:data.article,...option},
        }))
        const ids=new Set(cards.map(card=>card.id))
        let detached:DetachedCard[]=[]
        // Clear the request only on its own completion. Creation redo can run
        // while a newer request on the same brief is in flight.
        update(w=>({...w,annotations:[
          ...w.annotations.map(m=>m.id===id&&m.metaphor?{...m,metaphor:{...m.metaphor,explored:true,request:undefined}}:m),
          ...cards.filter(card=>!w.annotations.some(m=>m.id===card.id)),
        ]}))
        record({undo:()=>{
          detached=snapshot().workspace.annotations.filter(card=>ids.has(card.id)).map(detach)
          update(w=>({...w,annotations:w.annotations.filter(m=>!ids.has(m.id))}))
        },redo:()=>{
          update(w=>{
            const annotations=[...w.annotations]
            for(const card of detached)if(canRestore(card.mark,annotations))annotations.push(restore(card))
            return {...w,annotations}
          })
        },redoMarks:()=>detached.map(card=>card.mark)},true)
      }
      await session.flush()
    } catch(error) {
      errorMessage=error instanceof Error?error.message:String(error)
    } finally {
      removed.delete(id)
      session.setMetaphorStatus(id,errorMessage?{error:errorMessage}:{})
    }
  }

  function deleteMarks(ids:string[]) {
    const targets=new Set(ids)
    let entries:{card:DetachedCard;index:number}[]=[]
    let links:{id:string;index:number}[]=[]
    let dismissed:{briefId:string;id:string;option:MetaphorOption}[]=[]
    const redo=()=>update(w=>{
      entries=[]
      dismissed=[]
      w.annotations.forEach((mark,index)=>{
        if(!targets.has(mark.id))return
        entries.push({card:detach(mark),index})
        if(mark.metaphor?.kind==='option'&&mark.metaphor.briefId)
          dismissed.push({briefId:mark.metaphor.briefId,id:mark.id,option:optionOf(mark.metaphor)})
      })
      links=(w.promptBlockIds??[]).flatMap((id,index)=>targets.has(id)?[{id,index}]:[])
      const annotations=w.annotations.filter(mark=>!targets.has(mark.id)).map(mark=>{
        const options=dismissed.filter(entry=>entry.briefId===mark.id)
        if(mark.metaphor?.kind!=='brief'||!options.length)return mark
        const dismissedOptions={...mark.metaphor.dismissedOptions,...Object.fromEntries(options.map(({id,option})=>[id,option]))}
        return {...mark,metaphor:{...mark.metaphor,explored:true,dismissedOptions}}
      })
      return {...w,annotations,promptBlockIds:w.promptBlockIds?.filter(id=>!targets.has(id))}
    })
    const undo=()=>update(w=>{
      const annotations=w.annotations.map(mark=>{
        if(!mark.metaphor?.dismissedOptions)return mark
        const dismissedOptions={...mark.metaphor.dismissedOptions}
        for(const entry of dismissed)if(entry.briefId===mark.id)delete dismissedOptions[entry.id]
        return {...mark,metaphor:{...mark.metaphor,dismissedOptions}}
      })
      for(const {card,index} of entries) {
        if(canRestore(card.mark,annotations))annotations.splice(index,0,restore(card))
      }
      const promptBlockIds=[...w.promptBlockIds??[]]
      for(const {id,index} of links)if(!promptBlockIds.includes(id))promptBlockIds.splice(index,0,id)
      return {...w,annotations,promptBlockIds}
    })
    redo()
    return {undo,redo}
  }

  function useAsPrompt(id:string) {
    const mark=snapshot().workspace.annotations.find(m=>m.id===id)
    const data=mark?.metaphor
    if(!mark||data?.kind!=='option'||!data.scene?.trim())return
    if(data.promptId&&snapshot().workspace.annotations.some(m=>m.id===data.promptId&&m.kind==='prompt'))return data.promptId
    const prompt:BoardMark={id:crypto.randomUUID(),kind:'prompt',text:data.scene,points:[mark.points[0]]}
    prompt.points=[promptLocation(markRect(mark),markRect(prompt),obstacles())]
    const add=()=>update(w=>({...w,annotations:[...w.annotations.map(m=>m.id===id&&m.metaphor
      ?{...m,metaphor:{...m.metaphor,promptId:prompt.id}}:m),prompt]}))
    add()
    record({
      undo:()=>update(w=>({...w,annotations:w.annotations.filter(m=>m.id!==prompt.id).map(m=>m.id===id&&m.metaphor?{...m,metaphor:{...m.metaphor,promptId:undefined}}:m),promptBlockIds:w.promptBlockIds?.filter(link=>link!==prompt.id)})),
      redo:add,
    })
    return prompt.id
  }
  return {edit,explore,submitDraft,deleteMarks,useAsPrompt}
}
