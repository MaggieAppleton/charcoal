import type {BoardPatch} from './board-gestures'
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react'
import {Board,type BoardHandle} from './Board'
import {Composer} from './Composer'
import {Edit} from './Edit'
import {Icon} from './Icon.js'
import {ReferenceLibrary} from './ReferenceLibrary'
import {RenameImageDialog} from './RenameImageDialog'
import {ReplaceBoardDialog} from './ReplaceBoardDialog'
import {Review,type CandidateAction} from './Review'
import {RunDialog} from './RunDialog'
import {Tooltip} from './Tooltip'
import {WorkspaceMenu} from './WorkspaceMenu'
import type {BoardSession} from './board-session'
import {clipboardImages} from './clipboard'
import {providerCredentials,type BoardList} from './client'
import {guideLayer,guidePercent} from './guides'
import {promptParts,SIZES} from './request.js'
import {linkedPromptBlocks} from './prompt-blocks'
import {studyDraft} from './study-draft'
import {hasPromptText,keepAttachedMentions,missingImageMentions} from './inline-reference-draft.js'
import {imageMention,resolveImageMentions} from './image-mentions.js'
import {BATCH_PLAN_CONTRACT_VERSION,MAX_BATCH_BRIEF_LENGTH,MAX_RUN_PROMPT_LENGTH,renderComposition} from './composition-plan.js'
import {briefExplored,metaphorActions} from './metaphor-actions'
import {suggestVariation,studyAxis,styleRulesForStudy} from './studies.js'
import {PinnedImages} from './PinnedImages'
import {markRect} from './board-marks'
import {activeStyle,effectiveRules,saveStyleVersion} from './styles'
import {candidateAgeMs,candidatePositions,importPositions,itemsFor,NEW_RESULT_MS} from './workspace'
import type {Asset,GuideMode,Run,Workspace,StudyMode} from './model'
import type {Point} from './board-geometry'

type Layer = {id:string; mode:'edit'|'review'; origin?:DOMRect; initialLayer?:'area'|'sketch'}
const message = (error:unknown)=>error instanceof Error?error.message:String(error)

function draftKey(w:Workspace,contractVersion:number|null=BATCH_PLAN_CONTRACT_VERSION) {
  return JSON.stringify({...(contractVersion===null?{}:{contractVersion}),prompt:w.prompt,blocks:linkedPromptBlocks(w.promptBlockIds,w.annotations),
    settings:w.settings,mode:w.studyMode,variation:w.variationAxis,
    target:w.target,attachments:w.attachments,references:w.referenceDirections,guideMode:w.guideMode,
    guide:w.target?w.guides[w.target]:[],rules:effectiveRules(w.styleStore)})
}

function withoutAttachments(workspace:Workspace,ids:ReadonlySet<string>):Workspace {
  return {
    ...workspace,
    attachments:workspace.attachments.filter((id)=>!ids.has(id)),
    ...(workspace.target!==null&&ids.has(workspace.target)?{target:null,guideMode:'whole'}:{}),
  }
}

type Props = {
  session:BoardSession
  catalogue:BoardList
  focusWorkspace:boolean
  onBoardSelect:(id:string)=>Promise<void>
  onBoardCreate:(name:string)=>Promise<void>
  onBoardRename:(name:string)=>Promise<void>
  onBoardSetArchived:(id:string,archived:boolean)=>Promise<void>
}

export function App({session,catalogue,focusWorkspace,onBoardSelect,onBoardCreate,onBoardRename,onBoardSetArchived}:Props) {
  const {boot,workspace:w,projectVersion,saveError,submissions,metaphorStatus} = useSyncExternalStore(session.subscribe,session.snapshot)
  const {client,setBoot,setWorkspace,refresh} = session
  const [metaphorMode,setMetaphorMode] = useState(false)
  const [metaphorSelection,setMetaphorSelection] = useState<string|null>(null)
  const [articleInput,setArticleInput] = useState<string|null>(null)
  const [articleStatus,setArticleStatus] = useState<{busy?:boolean;error?:string}>({})
  const articleLock = useRef(false)
  const [layer,setLayer] = useState<Layer|null>(null)
  const [details,setDetails] = useState<string|null>(null)
  const [projectToOpen,setProjectToOpen] = useState<File|null>(null)
  const [imageToRename,setImageToRename] = useState<{id:string;name:string;trigger:HTMLButtonElement}|null>(null)
  const [highlight,setHighlight] = useState<string|null>(null)
  const [notice,setNotice] = useState('')
  const [error,setError] = useState('')
  const [unavailableBatch,setUnavailableBatch] = useState<string>()
  const [dragging,setDragging] = useState(false)
  const [showReferences,setShowReferences] = useState(false)
  const [showPins,setShowPins] = useState(false)
  const [sending,setSending] = useState(false)
  const [sent,setSent] = useState(false)
  const pinsButton = useRef<HTMLButtonElement>(null)
  const [now,setNow] = useState(()=>Date.now())
  const referencesButton = useRef<HTMLButtonElement>(null)
  const board = useRef<BoardHandle>(null)
  const metaphors=metaphorActions(session,()=>board.current?.placement())
  const selectedMark=w.annotations.find(mark=>mark.id===metaphorSelection)??(metaphorSelection
    ? w.annotations.find(mark=>mark.metaphor?.dismissedOptions&&Object.hasOwn(mark.metaphor.dismissedOptions,metaphorSelection))
    : undefined)
  const selectedMetaphor=selectedMark?.metaphor
  const selectedMetaphorId=selectedMark?.id
  const draft=w.metaphorDraft??{context:''}
  const metaphorSource=w.annotations.find(mark=>mark.id===selectedMetaphor?.briefId&&mark.metaphor?.kind==='brief')
  const context=selectedMetaphor?.context??draft.context
  const draftBrief=w.annotations.find(mark=>mark.id===draft.briefId&&mark.metaphor?.kind==='brief'&&mark.metaphor.context===context)
  const shownId=selectedMetaphor ? selectedMetaphorId : draftBrief?.id
  const shownStatus=shownId ? metaphorStatus[shownId] : undefined
  const shownMetaphor=selectedMetaphor??draftBrief?.metaphor
  const matchingOptions=shownId?w.annotations.filter(mark=>mark.metaphor?.kind==='option'&&mark.metaphor.briefId===shownId):[]
  const canAppend=shownMetaphor?.kind==='brief'&&briefExplored(shownMetaphor,matchingOptions.length)
  const frame = useRef<HTMLElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const projectFile = useRef<HTMLInputElement>(null)
  const sendLock = useRef(false)
  const {assets,runs} = boot
  const fingerprint=draftKey(w)
  const pending=w.pendingSubmission
  const matchingBatch=pending && (pending.fingerprint===fingerprint ||
    [3,2,1,null].some(version=>pending.fingerprint===draftKey(w,version))) ? pending : undefined
  const recoveryUnavailable=!!matchingBatch && matchingBatch.ids[0]===unavailableBatch
  const batchPending = matchingBatch?.ids.some(id=>runs.some(run=>run.id===id&&run.status==='pending') ||
    submissions.some(job=>job.id===id&&job.status==='pending')) ?? false
  const submitted = batchPending && matchingBatch?.ids.every(id=>runs.some(run=>run.id===id)||submissions.some(job=>job.id===id&&job.status==='pending'))
  const deletedIds = new Set(w.deletedImageIds)

  const patch = (update:Partial<Workspace> & Pick<BoardPatch,'markPoints'|'markChanges'>)=>setWorkspace((prev)=>{
    const {markPoints,markChanges,...workspaceUpdate}=update
    const next={...prev,...workspaceUpdate}
    if(markPoints) next.annotations=prev.annotations.map(mark=>markPoints[mark.id]?{...mark,points:markPoints[mark.id]}:mark)
    if(markChanges) {
      const remaining=new Map(markChanges)
      next.annotations=next.annotations.flatMap(mark=>{
        if(!remaining.has(mark.id))return [mark]
        const changed=remaining.get(mark.id)
        remaining.delete(mark.id)
        return changed?[changed.mark]:[]
      })
      const additions=[...remaining.values()].filter(change=>change!==null).sort((a,b)=>a.index-b.index)
      for(const {mark,index} of additions)next.annotations.splice(index,0,mark)
    }
    if ((update.annotations||markChanges) && next.promptBlockIds?.length) {
      next.promptBlockIds=linkedPromptBlocks(next.promptBlockIds,next.annotations).map(block=>block.id)
    }
    return next
  })
  const promptBlocks=useMemo(()=>linkedPromptBlocks(w.promptBlockIds,w.annotations),[w.promptBlockIds,w.annotations])
  const composedPrompt=[...promptBlocks.map(block=>block.text),w.prompt.trim()].filter(Boolean).join('\n\n')
  const selected = w.target ? [w.target,...w.attachments.filter((x)=>x!==w.target)] : w.attachments
  const items = useMemo(()=>itemsFor(w,assets,runs,boot.demo,now),[w,assets,runs,boot.demo,now])
  const positions = useMemo(()=>candidatePositions(runs,assets,w.positions),[runs,assets,w.positions])
  const image = (id:string|null)=>assets.find((a)=>a.id===id)
  const references = (w.referenceIds ?? []).flatMap((id)=>image(id) ?? [])
  const canvasIds = items.filter((item)=>!deletedIds.has(item.id)).map((item)=>item.id)
  const studyMode=w.studyMode ?? 'illustration'
  const regionalEdit=!!w.target && w.guideMode==='mask'
  const suggestedVariation=suggestVariation(composedPrompt,!!w.target)
  const variation=w.variationAxis??suggestedVariation
  const pauseStyle=studyMode!=='composition' && (studyMode!=='illustration' ||
    (!regionalEdit && Number(w.settings.count)>1 && variation!=='composition' && variation!=='freeform'))
  const rules = styleRulesForStudy(pauseStyle ? [] : effectiveRules(w.styleStore),studyMode)
  const style = activeStyle(w.styleStore)
  const studyPreviews=studyDraft({prompt:composedPrompt,settings:w.settings,mode:studyMode,
    inputs:selected.flatMap(id=>image(id)??[]),guideMode:w.guideMode,variation})
  const needsPlan=studyPreviews.length>1
  const missingReferences=missingImageMentions(composedPrompt,selected).length>0
  const userBrief=resolveImageMentions(composedPrompt,selected.flatMap(id=>image(id)??[]))
  const promptLength=needsPlan ? userBrief.length : studyPreviews[0].prompt.trim().length
  const promptLimit=needsPlan ? MAX_BATCH_BRIEF_LENGTH : MAX_RUN_PROMPT_LENGTH
  const partial=matchingBatch?.ids.length===studyPreviews.length && matchingBatch.ids.some(id=>!runs.some(run=>run.id===id))
  const recoverPlanOnly=partial && (matchingBatch.fingerprint!==fingerprint ||
    matchingBatch.ids.some(id=>runs.some(run=>run.id===id)))
  const checkingSavedBatch=!recoveryUnavailable && (matchingBatch?.recoveryOnly || (needsPlan && recoverPlanOnly))
  const lengthNotice=!checkingSavedBatch && promptLength>promptLimit ? `Use up to ${promptLimit.toLocaleString()} characters in the prompt.` : ''
  const hasLiteralBrief=hasPromptText(composedPrompt)
  const imageDirectedStudy=selected.length>0 && (studyMode!=='illustration' || (!!w.target && w.guideMode==='markup'))
  const canSend=!missingReferences && !lengthNotice && !sending && !sent && !submitted &&
    (studyMode==='illustration' || studyMode==='composition' || !!w.target) &&
    (needsPlan ? hasLiteralBrief : !!studyPreviews[0].prompt.trim() && (hasLiteralBrief || imageDirectedStudy))
  const parts = promptParts({prompt:studyPreviews[0].prompt,inputs:selected.flatMap((id)=>image(id)??[]),target:w.target,
    guideMode:w.guideMode,rules,styleName:style?.name})
  const layerImage = layer && image(layer.id)
  const layerRun = layer && runs.find((r)=>r.candidates.some((c)=>c.id===layer.id))
  const candidate = layerRun?.candidates.find((c)=>c.id===layer?.id)
  const retried = new Set(runs.flatMap((r)=>r.retriedFrom??[]))
  const deletedRunIds = new Set(w.deletedRunIds)
  const canvasRuns = runs.filter((r)=>r.status!=='done'&&!r.candidates.length&&!retried.has(r.id)&&!deletedRunIds.has(r.id))
  const busy = submissions.some(job=>job.status==='pending') || runs.some((r)=>r.status==='pending'||r.candidates.some((c)=>c.reviewStatus==='pending'))

  useEffect(()=>{
    if (!sent) return
    const timer=window.setTimeout(()=>setSent(false),2200)
    return ()=>window.clearTimeout(timer)
  },[sent])

  useEffect(()=>{
    void refresh().catch((err)=>setError(message(err)))
  },[refresh])

  useEffect(()=>{
    if (!busy) return
    const timer=window.setInterval(()=>void refresh().catch(()=>{}),700)
    return ()=>window.clearInterval(timer)
  },[busy,refresh])

  useEffect(()=>{
    const current=Date.now()
    let nextDelay=Infinity
    for (const run of runs) {
      for (const item of run.candidates) {
        if (item.seen) continue
        const remaining=NEW_RESULT_MS-candidateAgeMs(item,run,current)
        if (remaining>0 && remaining<nextDelay) nextDelay=remaining
      }
    }
    if (!Number.isFinite(nextDelay)) return
    const timer=window.setTimeout(()=>setNow(Date.now()),nextDelay+50)
    return ()=>window.clearTimeout(timer)
  },[runs,now])

  async function importArticle() {
    if(!articleInput?.trim()||articleLock.current)return
    articleLock.current=true
    setArticleStatus({busy:true})
    try {
      const {text,...article}=await client.importArticle(articleInput.trim())
      if(session.snapshot().projectVersion!==projectVersion)return
      const previous=session.snapshot().workspace.metaphorDraft
      const context=[previous?.context,text].filter(Boolean).join('\n\n')
      if(context.length>100000)throw new Error('The article and your notes exceed the brief limit. Shorten your notes and try again.')
      patch({metaphorDraft:{...previous,context,article}})
      setArticleInput(null)
      setArticleStatus({})
    } catch(error) {
      if(session.snapshot().projectVersion===projectVersion)setArticleStatus({error:message(error)})
    } finally {
      articleLock.current=false
    }
  }

  function selectMetaphor(id:string|null) {
    setMetaphorMode(true);setMetaphorSelection(id)
    requestAnimationFrame(()=>{
      const field=frame.current?.querySelector<HTMLTextAreaElement>('#metaphor-input')
      const focusable=field?.disabled?frame.current?.querySelector<HTMLInputElement>('.metaphor-composer-heading input:not(:disabled)'):field
      focusable?.focus({preventScroll:true})
    })
  }

  function attachMany(ids:string[]) {
    const additions=ids.filter((id)=>!selected.includes(id))
    const available=8-selected.length
    const accepted=additions.slice(0,available)
    if (accepted.length) patch({attachments:[...w.attachments,...accepted]})
    setNotice(additions.length>available?`Eight images at most. Remove one to add ${image(additions[available])?.name ?? 'another image'}.`:'')
  }
  function clearIllustration() {
    if (layer?.mode==='edit') closeLayer()
    patch({prompt:'',attachments:[],target:null,guideMode:'whole',promptBlockIds:[],referenceDirections:{}})
    setHighlight(null)
    setNotice('')
  }
  function clearMetaphor() {
    if (selectedMetaphor?.kind==='option' && metaphorSelection) {
      metaphors.edit(metaphorSelection,{feedback:''})
    } else if (!selectedMetaphor) {
      patch({metaphorDraft:{context:''}})
      setArticleInput(null)
      setArticleStatus({})
    }
  }
  function remove(id:string) { detachMany([id]) }
  function detachMany(ids:string[]) {
    const removed=new Set(ids)
    if (layer?.mode==='edit' && removed.has(layer.id)) closeLayer()
    setWorkspace((prev)=>withoutAttachments(prev,removed))
    setNotice('')
  }
  function removePromptBlock(id:string) {
    setWorkspace(prev=>({...prev,promptBlockIds:prev.promptBlockIds?.filter(link=>link!==id)}))
  }
  function togglePromptBlock(id:string) {
    setWorkspace(prev=>{
      const links=prev.promptBlockIds??[]
      return {...prev,promptBlockIds:links.includes(id)?links.filter(link=>link!==id):[...links,id]}
    })
  }
  function deleteSelection(ids:string[],markIds:string[]) {
    const removedIds = new Set(ids)
    const previous = session.snapshot().workspace
    const deletion=markIds.length?metaphors.deleteMarks(markIds):undefined
    if(metaphorSelection&&markIds.includes(metaphorSelection))setMetaphorSelection(
      metaphorSource&&!markIds.includes(metaphorSource.id)?metaphorSource.id:null)
    let promptBeforeDelete = w.prompt
    let promptAfterDelete = w.prompt
    const removeImages = () => {
      if(!ids.length)return
      promptBeforeDelete=session.snapshot().workspace.prompt
      setWorkspace((prev)=>({
        ...withoutAttachments(prev,removedIds),
        ...(prev.active && removedIds.has(prev.active)?{active:null}:{}),
        deletedImageIds:[...new Set([...(prev.deletedImageIds ?? []),...ids])],
      }))
      promptAfterDelete=session.snapshot().workspace.prompt
      setHighlight(null)
      setNotice('')
    }
    const restoreImages = () => setWorkspace((prev)=>{
      const restoredIds = new Set(prev.deletedImageIds?.filter((id)=>removedIds.has(id)))
      if (!restoredIds.size) return prev
      const attachments = [...prev.attachments]
      let {target,guideMode} = prev
      if (target===null && previous.target!==null && restoredIds.has(previous.target) && attachments.length<8) {
        target=previous.target
        guideMode=previous.guideMode
      }
      for (const [index,id] of previous.attachments.entries()) {
        if (restoredIds.has(id) && id!==target && !attachments.includes(id) && attachments.length+Number(target!==null)<8) {
          attachments.splice(index,0,id)
        }
      }
      const active = prev.active ?? (previous.active!==null && restoredIds.has(previous.active)
        && (previous.active===target || attachments.includes(previous.active)) ? previous.active : null)
      return {
        ...prev,attachments,target,guideMode,active,
        prompt:prev.prompt===promptAfterDelete?promptBeforeDelete:prev.prompt,
        deletedImageIds:prev.deletedImageIds?.filter((id)=>!restoredIds.has(id)),
      }
    })
    removeImages()
    return {
      undo:()=>{deletion?.undo();restoreImages()},
      redo:()=>{deletion?.redo();removeImages()},
    }
  }
  function deleteMetaphor() {
    if(!metaphorSelection||selectedMetaphor?.kind!=='option')return
    session.history.record(deleteSelection([], [metaphorSelection]))
    selectMetaphor(metaphorSource?.id??null)
  }
  function deleteRun(id:string) {
    const redo = () => setWorkspace((prev)=>({...prev,deletedRunIds:[...new Set([...(prev.deletedRunIds ?? []),id])]}))
    const undo = () => setWorkspace((prev)=>({...prev,deletedRunIds:prev.deletedRunIds?.filter((runId)=>runId!==id)}))
    redo()
    return {undo,redo}
  }
  function open(id:string,mode:Layer['mode'],initialLayer?:'area'|'sketch') {
    const node=frame.current?.querySelector<HTMLElement>(`.tile[data-id="${CSS.escape(id)}"]`)
    setLayer({id,mode,initialLayer,origin:node?.getBoundingClientRect()})
    setDetails(null)
    if (mode==='edit') {
      setMetaphorMode(false)
      if (!selected.includes(id) && selected.length===8) {
        setLayer(null); setNotice('Eight images at most. Remove one to edit this image.'); return
      }
      const guides=w.guides[id]??[]
      const current=guides.filter((g)=>!g.erase).at(-1)
      const attachments=w.attachments.filter(reference=>reference!==id)
      if (w.target && w.target!==id && missingImageMentions(composedPrompt,attachments).includes(w.target)) {
        attachments.unshift(w.target)
      }
      patch({target:id,guideMode:id===w.target?w.guideMode:current?.layer==='area'?'mask':current?'markup':'whole',
        attachments,active:null,
        ...(studyMode==='composition'?{studyMode:'illustration'}:{})})
    } else {
      const run=runs.find((r)=>r.candidates.some((c)=>c.id===id))
      if (run) void client.candidate(run.id,id,{kind:'seen'}).then(refresh).catch((e)=>setError(message(e)))
    }
  }
  function closeLayer() {
    if (!layer) return
    const {mode,id}=layer
    setLayer(null)
    requestAnimationFrame(()=>{
      if (mode==='edit') frame.current?.querySelector<HTMLElement>('#prompt')?.focus({preventScroll:true})
      else board.current?.focusImage(id)
    })
  }

  async function upload(batch:File[],onError:(error:string)=>void=setError) {
    const result:Asset[]=[]
    const failures:string[]=[]
    for (const file of batch) {
      try { result.push(await client.upload(file)) }
      catch (err) { failures.push(`${file.name}: ${message(err)}`) }
    }
    setBoot((prev)=>({...prev,assets:[...prev.assets.filter((a)=>!result.some((b)=>a.id===b.id)),...result]}))
    if (failures.length) onError(failures.join(' '))
    return result
  }
  function addToCanvas(assets:Asset[],positions:Workspace['positions'],attach=false) {
    const ids=assets.map((asset)=>asset.id)
    const placed=new Set(ids)
    const previous=session.snapshot().workspace
    const newIds=ids.filter((id)=>!previous.imageIds.includes(id) && !items.some((item)=>item.id===id))
    const added=new Set(newIds)
    const restoredTombstones=previous.deletedImageIds?.filter((id)=>placed.has(id)) ?? []
    const previousPositions=Object.fromEntries(ids.map((id)=>[id,previous.positions[id]]))
    const previousInputs={target:previous.target,guideMode:previous.guideMode,attachments:previous.attachments,active:previous.active}

    let promptBeforePlacement=previous.prompt
    const redo=()=>setWorkspace((prev)=>{
      promptBeforePlacement=prev.prompt
      return {
        ...prev,
        imageIds:[...prev.imageIds,...newIds.filter((id)=>!prev.imageIds.includes(id))],
        deletedImageIds:prev.deletedImageIds?.filter((id)=>!placed.has(id)),
        positions:{...prev.positions,...positions},
        ...(attach?{target:null,guideMode:'whole',attachments:ids,active:ids.at(-1)!}:{}),
      }
    })
    const undo=()=>setWorkspace((prev)=>{
      const restored={...prev.positions}
      for (const id of ids) {
        if (previousPositions[id]) restored[id]=previousPositions[id]
        else delete restored[id]
      }
      const removedInputs=new Set(ids.filter((id)=>!prev.referenceIds?.includes(id)))
      const inputsUnchanged=attach && prev.target===null && prev.attachments.length===ids.length
        && prev.attachments.every((id,index)=>id===ids[index])
      const prePlacementInputs=new Set(previousInputs.attachments)
      if (previousInputs.target) prePlacementInputs.add(previousInputs.target)
      const restorePrompt=inputsUnchanged &&
        keepAttachedMentions(prev.prompt,prePlacementInputs).trim()===keepAttachedMentions(promptBeforePlacement,new Set(ids)).trim()
      return {
        ...withoutAttachments(prev,removedInputs),
        ...(restorePrompt?{prompt:promptBeforePlacement}:{}),
        imageIds:prev.imageIds.filter((id)=>!added.has(id)),
        positions:restored,
        deletedImageIds:restoredTombstones.length
          ? [...new Set([...(prev.deletedImageIds ?? []),...restoredTombstones])]
          : prev.deletedImageIds,
        ...(inputsUnchanged?previousInputs:{}),
      }
    })
    redo()
    session.history.record({undo,redo})
  }

  async function importBoard(batch:File[],at?:Point,attach=false) {
    if (!batch.length) return
    const origin=at??board.current?.center()??{x:48,y:72}
    const occupied=items.flatMap((item)=>board.current?.getImageRect(item.id)??[])
    const importTrigger=document.activeElement?.closest('button.import,button.empty-import')
    try {
      await session.runAssetImport(async()=>{
        const added=await upload(batch)
        const current=session.snapshot()
        if (!added.length || current.projectVersion!==projectVersion) return
        const deleted=new Set(current.workspace.deletedImageIds)
        const occupiedPositions=Object.entries(current.workspace.positions).flatMap(([id,rect])=>deleted.has(id)?[]:[rect])
        const focusCanvas=importTrigger && importTrigger===document.activeElement
        addToCanvas(added,importPositions(added,origin,[...occupied,...occupiedPositions]),attach)
        if (focusCanvas) board.current?.focus()
      })
    } catch (err) { setError(message(err)) }
  }
  async function uploadReferences(batch:File[]) {
    await session.runAssetImport(async()=>{
      let failure = ''
      const added = await upload(batch,(text)=>{failure=text})
      if (added.length) setWorkspace((prev)=>({
        ...prev,referenceIds:[...(prev.referenceIds ?? []),...added.map((asset)=>asset.id)],
      }))
      if (failure) throw new Error(failure)
    })
  }

  function placeReference(id:string) {
    const asset = image(id)
    if (!asset || canvasIds.includes(id)) return
    const origin = board.current?.center() ?? {x:48,y:72}
    const occupied = canvasIds.flatMap((imageId)=>board.current?.getImageRect(imageId) ?? [])
    addToCanvas([asset],importPositions([asset],origin,occupied))
    setShowReferences(false)
    requestAnimationFrame(()=>board.current?.focusImage(id))
  }

  function removeReference(id:string) {
    setWorkspace((prev)=>({
      ...(canvasIds.includes(id) ? prev : withoutAttachments(prev,new Set([id]))),
      referenceIds:prev.referenceIds?.filter((imageId)=>imageId!==id),
    }))
  }

  function showRenameImage(id:string,trigger:HTMLButtonElement) {
    const asset=image(id)
    if (asset) setImageToRename({id,name:asset.name,trigger})
  }

  async function renameImage(id:string,name:string) {
    const renamed=await client.renameAsset(id,name)
    setBoot((prev)=>({...prev,assets:prev.assets.map((asset)=>asset.id===id?renamed:asset)}))
  }

  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if (e.key==='Tab') delete document.documentElement.dataset.modality
      if (e.key!=='Escape'||e.defaultPrevented||details||projectToOpen||imageToRename||frame.current?.querySelector('.pop:not([hidden])')) return
      if (!frame.current?.querySelector('#workspace-menu')) closeLayer()
    }
    const paste=(e:ClipboardEvent)=>{
      if (projectToOpen||imageToRename||layer||details) return
      const batch=clipboardImages(e.clipboardData,document.activeElement)
      if (batch.length) { e.preventDefault(); void importBoard(batch) }
    }
    window.addEventListener('keydown',key)
    window.addEventListener('paste',paste)
    return ()=>{window.removeEventListener('keydown',key);window.removeEventListener('paste',paste)}
  })
  async function send(startFresh=false) {
    if (sendLock.current || !canSend || recoveryUnavailable!==startFresh) return
    const previous=startFresh?undefined:matchingBatch
    if(previous?.recoveryOnly) {
      // Import already reconciled durable results. A missing image may still
      // have been charged on the source board, even for a single-image batch.
      setUnavailableBatch(previous.ids[0])
      return
    }
    const batch=previous && partial ? previous : {fingerprint,ids:studyPreviews.map(()=>crypto.randomUUID())}
    const submissionIds=batch.ids
    const recoveryOnly=!startFresh && recoverPlanOnly
    sendLock.current=true
    setError('')
    setSending(true)
    setSent(true)
    try {
      const target=image(w.target)
      const guide=target?w.guides[target.id]??[]:[]
      const guideMode=target?w.guideMode:'whole'
      const saved=!pauseStyle&&style&&saveStyleVersion(style)
      const snapshot=saved?{name:saved.name,version:saved.version,rules}:null
      if (saved && saved!==style) setWorkspace((prev)=>({
        ...prev,styleStore:{...prev.styleStore,styles:prev.styleStore.styles.map((s)=>s.id===saved.id?saved:s)},
      }))
      const inputRects=selected.flatMap((id)=>board.current?.getImageRect(id)??[])
      const center=board.current?.center()??{x:48,y:72}
      const [px,py]=SIZES[w.settings.size].split('x').map(Number)
      const sourceRect=inputRects[0]
      const width=studyMode==='composition'?144:sourceRect?.width??176
      const height=target?width*target.height/target.width:width*py/px
      let x=inputRects.length?Math.max(...inputRects.map((r)=>r.x+r.width))+24:center.x-width/2
      const y=sourceRect?.y??center.y-height/2
      const rowWidth=(width+12)*Number(w.settings.count)
      const occupied=[...items.flatMap((i)=>board.current?.getImageRect(i.id)??[]),
        ...w.annotations.filter(mark=>mark.kind==='prompt').map(markRect),
        ...submissions.filter(job=>!submissionIds.includes(job.id)).map(job=>job.rect),
        ...runs.filter((r)=>r.status!=='done'&&!deletedRunIds.has(r.id)).map((r)=>({...r.rect,width:(r.rect.width+6)*Number(r.settings.count)}))]
      for (const other of occupied.sort((a,b)=>a.x-b.x)) {
        if (x<other.x+other.width+8 && x+rowWidth+8>other.x && y<other.y+other.height+8 && y+height+8>other.y) x=other.x+other.width+16
      }
      const drafts=studyPreviews.map((_,index)=>({id:submissionIds[index],label:composedPrompt.slice(0,65),
        rect:submissions.find(job=>job.id===submissionIds[index])?.rect ?? {x:x+index*(width+12),y,width,height},
        status:'pending' as const}))
      const outstanding=drafts.filter(job=>!runs.some(run=>run.id===job.id))
      session.setSubmissions(previous=>[...previous.filter(job=>!submissionIds.includes(job.id)),...outstanding])
      setWorkspace(prev=>({...prev,pendingSubmission:batch,
        runBriefs:{...prev.runBriefs,...Object.fromEntries(outstanding.map(({id})=>[id,{prompt:composedPrompt,referenceDirections:w.referenceDirections??{}}]))}}))
      if (layer?.mode==='edit') closeLayer()
      // Paint the acknowledgement and placeholders before preparing large edit guides.
      await new Promise<void>(resolve=>{
        const fallback=setTimeout(resolve,50)
        requestAnimationFrame(()=>{clearTimeout(fallback);setTimeout(resolve,0)})
      })
      let guidePng:string|undefined
      if (target&&guideMode!=='whole') {
        const ctx=guideLayer(guide,guideMode==='mask'?'area':'sketch',target.width,target.height)
        if (guidePercent(ctx)===0) throw new Error(w.guideMode==='mask'?'Paint an edit area before sending.':'Draw a sketch before sending.')
        guidePng=ctx.canvas.toDataURL('image/png').split(',')[1]
      }
      await session.flush()
      const axis=regionalEdit?'freeform':studyAxis(studyMode,variation)
      const plan=!needsPlan?null:recoveryOnly?await client.recoverPlan(submissionIds[0]):await client.planCompositions({
        contractVersion:BATCH_PLAN_CONTRACT_VERSION,regionalEdit,id:submissionIds[0],count:studyPreviews.length,inputs:selected,userBrief,
        ...(axis==='composition'?{}:{axis}),
        prompt:[`Output format: ${w.settings.size} (${SIZES[w.settings.size]}). Compose every alternative within this aspect ratio.`,...(regionalEdit?['These are local edits around the painted area. Coordinate different ways to apply the requested local change; preserve the rest of the source composition.']:[]),...parts.map(part=>part.text)].join('\n')})
      if (needsPlan && !plan) {
        setUnavailableBatch(submissionIds[0])
        session.setSubmissions(previous=>previous.filter(job=>!submissionIds.includes(job.id)))
        setSent(false)
        return
      }
      for (const [index,study] of studyPreviews.entries()) {
        const id=submissionIds[index]
        if (session.snapshot().boot.runs.some(run=>run.id===id)) continue
        const run=await client.submit({id,prompt:plan?renderComposition(study.prompt,plan,index,axis,studyMode):study.prompt,inputs:selected,target:w.target,
          guideMode,guide,guidePng,settings:study.settings,style:snapshot,rect:drafts[index].rect})
        setBoot((prev)=>({...prev,runs:[...prev.runs.filter((r)=>r.id!==run.id),run]}))
        if (run.status==='failed'||run.status==='uncertain') setDetails(run.id)
      }
      // A new draft typed during submission should remain immediately sendable.
      if (draftKey(session.snapshot().workspace)!==fingerprint) return
      if (Object.keys(w.styleStore.overrides).length) setWorkspace(prev=>{
        if (prev.styleStore.overrides!==w.styleStore.overrides) return prev
        const next={...prev,styleStore:{...prev.styleStore,overrides:{}}}
        return draftKey(prev)===fingerprint
          ? {...next,pendingSubmission:{fingerprint:draftKey(next),ids:submissionIds}} : next
      })
    } catch (err) {
      const error=message(err)
      session.setSubmissions(previous=>previous.map(job=>submissionIds.includes(job.id)?{...job,status:'failed',error}:job))
      setSent(false)
      setError(error)
    }
    finally { sendLock.current=false;setSending(false) }
  }

  function changeStudy(mode:StudyMode) {
    patch({studyMode:mode,...(mode==='composition'?{target:null,guideMode:'whole',attachments:selected}:{})})
  }
  function togglePin(id:string) {
    setWorkspace(prev=>({...prev,pinnedIds:prev.pinnedIds?.includes(id)
      ? prev.pinnedIds.filter(item=>item!==id) : [...(prev.pinnedIds??[]),id]}))
  }

  async function candidateAction(action:CandidateAction) {
    if (!layerRun||!candidate) return
    try { await client.candidate(layerRun.id,candidate.id,action); await refresh() }
    catch (err) { setError(message(err));throw err }
  }
  function revise(prompt:string) {
    if (!candidate||!layerRun) return
    const id=candidate.id
    const refs=layerRun.inputs.filter((a)=>a!==layerRun.target)
    const original=w.runBriefs?.[layerRun.id]
    const brief=prompt===layerRun.prompt&&original?original.prompt:prompt
    patch({target:id,guideMode:layerRun.guideMode,prompt:layerRun.target?brief.replaceAll(imageMention(layerRun.target),imageMention(id)):brief,
      referenceDirections:original?.referenceDirections??w.referenceDirections,promptBlockIds:[],attachments:refs.slice(0,7),
      guides:{...w.guides,[id]:layerRun.guide},active:null,studyMode:'illustration'})
    if (refs.length>7) setNotice('The revision has seven references plus its edit target. Remove a reference to restore the eighth.')
    setLayer(null);setMetaphorMode(false)
    requestAnimationFrame(()=>frame.current?.querySelector<HTMLElement>('#prompt')?.focus())
  }

  async function openProject(file:File) {
    board.current?.finishWheel()
    await session.openProject(file)
    setLayer(null);setDetails(null);setError('');setShowReferences(false);setMetaphorSelection(null);setMetaphorMode(false);setArticleInput(null);setArticleStatus({})
  }

  return <main className={`frame${dragging?' dropping':''}`} id="frame" ref={frame}
    onPointerDown={()=>{document.documentElement.dataset.modality='pointer'}}
    onDragOverCapture={(e)=>{if ((e.target as Element).closest('.reference-library')) setDragging(false)}}
    onDragOver={(e)=>{
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      if (!projectToOpen&&!imageToRename) setDragging(true)
    }}
    onDragLeave={(e)=>{if (!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}}
    onDrop={(e)=>{
      if (!e.dataTransfer.files.length) return
      e.preventDefault();setDragging(false)
      if (!projectToOpen&&!imageToRename) void importBoard(Array.from(e.dataTransfer.files),board.current?.clientToWorld(e.clientX,e.clientY))
    }}>
    <Board key={projectVersion} ref={board} history={session.history} items={items} positions={positions} deletedImageIds={w.deletedImageIds}
      pinnedIds={w.pinnedIds} onTogglePin={togglePin} onAnnotate={id=>open(id,'edit','sketch')}
      camera={w.camera} annotations={w.annotations}
      metaphorStatus={metaphorStatus} selectedMetaphor={metaphorMode?selectedMetaphorId??null:null} onSelectMetaphor={selectMetaphor}
      promptBlockIds={w.promptBlockIds} onTogglePromptBlock={togglePromptBlock}
      attachments={selected} active={w.active} target={w.target} highlighted={highlight} disabled={!!layer}
      jobs={[...canvasRuns.map((r)=>({
        id:r.id,label:r.label,status:r.status,rect:r.rect,onOpen:()=>setDetails(r.id),
        onDelete:r.status==='failed'||r.status==='uncertain'?()=>deleteRun(r.id):undefined,
      })),...submissions.filter(job=>!deletedRunIds.has(job.id)).map(job=>({...job,
        onOpen:()=>{if(job.error)setError(job.error)},
        onDelete:job.status==='failed'?()=>deleteRun(job.id):undefined,
      }))]}
      onChange={(p)=>patch(p)} onActive={(active)=>patch({active})} onHighlight={setHighlight}
      onToggle={(id)=>selected.includes(id)?remove(id):attachMany([id])} onAttachMany={attachMany} onDetachMany={detachMany}
      onEdit={(id)=>open(id,'edit')} onRename={showRenameImage} onDelete={deleteSelection} onReview={(id)=>open(id,'review')} onFlatten={(file,point)=>importBoard([file],point,true)}/>
    {items.every((item)=>deletedIds.has(item.id))&&!w.annotations.length&&!canvasRuns.length&&!submissions.length&&<button type="button" className="btn lead empty-import" onClick={()=>files.current?.click()}><Icon name="upload"/>Import images</button>}
    <div className="frame-navigation" inert={!!layer || undefined}>
      <button ref={referencesButton} className="btn" type="button" aria-haspopup="dialog"
        aria-expanded={showReferences} onClick={()=>{setShowReferences(!showReferences);setShowPins(false)}}>References</button>
      <button ref={pinsButton} className="btn" type="button" aria-haspopup="dialog"
        aria-expanded={showPins} onClick={()=>{setShowPins(!showPins);setShowReferences(false)}}>Pinned{w.pinnedIds?.length ? ` (${w.pinnedIds.length})` : ''}</button>
      <button className="btn lead import" type="button" onClick={()=>files.current?.click()} data-tip="Or drop images anywhere"><Icon name="upload"/>Import</button>
      <WorkspaceMenu catalogue={catalogue} focusOnMount={focusWorkspace}
        provider={boot.provider} sessionKey={Boolean(boot.sessionKey)}
        onSelect={(id)=>{board.current?.finishWheel();return onBoardSelect(id)}}
        onCreate={(name)=>{board.current?.finishWheel();return onBoardCreate(name)}} onRename={onBoardRename}
        onSetArchived={(id,archived)=>{board.current?.finishWheel();return onBoardSetArchived(id,archived)}}
        onSaveApiKey={async(apiKey)=>{
          const status=await providerCredentials.save(apiKey)
          setBoot((prev)=>({...prev,provider:status.provider,sessionKey:status.sessionKey}))
        }}
        onClearApiKey={async()=>{
          const status=await providerCredentials.clear()
          setBoot((prev)=>({...prev,provider:status.provider,sessionKey:status.sessionKey}))
        }}
        onRuns={()=>setDetails('all')} onOpenProject={()=>projectFile.current?.click()}
        onExport={()=>{
          board.current?.finishWheel()
          void session.flush().then(()=>{
            const link=document.createElement('a')
            link.href=client.exportUrl;link.download='charcoal-project.json';link.click()
          }).catch((err)=>setError(message(err)))
        }}/>
    </div>
    {showReferences && !layer && <ReferenceLibrary assets={references} attachedIds={selected} canvasIds={canvasIds}
      onUpload={uploadReferences} onAttach={(id)=>selected.includes(id)?remove(id):attachMany([id])}
      onPlace={placeReference} onRename={showRenameImage} onRemove={removeReference} onClose={()=>setShowReferences(false)} triggerRef={referencesButton}/>}
    {showPins && !layer && <PinnedImages assets={(w.pinnedIds??[]).flatMap(id=>image(id)??[])} onUnpin={togglePin}
      onRefine={id=>{setShowPins(false);open(id,'edit')}} onLocate={id=>{
        if (!canvasIds.includes(id)) placeReference(id)
        else board.current?.locate(id)
      }} onClose={()=>setShowPins(false)} triggerRef={pinsButton} />}
    <input type="file" ref={files} aria-label="Import images" accept="image/*" multiple hidden onChange={(e)=>{void importBoard(Array.from(e.target.files??[]));e.target.value=''}}/>
    <input type="file" ref={projectFile} aria-label="Open project" accept="application/json,.json" hidden onChange={(e)=>{
      const file=e.target.files?.[0]
      if (file) setProjectToOpen(file)
      e.target.value=''
    }}/>
    <Composer key={`composer-${projectVersion}`} onMode={setMetaphorMode} onClear={clearIllustration}
      metaphor={metaphorMode?{
        data:selectedMetaphor,context,status:shownStatus,optionCount:matchingOptions.length,
        canAppend,pendingRequest:!!shownMetaphor?.request,
        article:selectedMetaphor?selectedMetaphor.article:draft.article,
        articleImport:!selectedMetaphor?{input:articleInput,status:articleStatus,
          onInput:value=>{setArticleInput(value);setArticleStatus({})},
          onImport:()=>void importArticle()}:undefined,
        sourceAvailable:!!metaphorSource,hasPrompt:!!w.annotations.find(mark=>mark.id===selectedMetaphor?.promptId&&mark.kind==='prompt'),
        onContext:context=>selectedMetaphorId?metaphors.edit(selectedMetaphorId,{context}):patch({metaphorDraft:{...draft,context}}),
        onEdit:update=>{if(selectedMetaphorId)metaphors.edit(selectedMetaphorId,update)},
        onClear:clearMetaphor,
        onSubmit:()=>selectedMetaphorId?void metaphors.explore(selectedMetaphorId):metaphors.submitDraft(),
        onAdd:()=>{if(shownId)void metaphors.explore(shownId)},
        onRestart:()=>{if(shownId)void metaphors.explore(shownId,true)},
        onDelete:deleteMetaphor,
        onLocate:()=>{if(shownId)board.current?.locateGroup([shownId,...matchingOptions.map(mark=>mark.id)])},
        onDraft:()=>selectMetaphor(null),onSource:()=>{if(metaphorSource)selectMetaphor(metaphorSource.id)},
        onPrompt:()=>{
          const id=metaphorSelection&&metaphors.useAsPrompt(metaphorSelection)
          if(id)board.current?.locate(id)
        },
      }:undefined}
      assets={assets} attachments={selected} target={w.target} guideMode={w.guideMode}
      studyMode={studyMode} onStudyMode={changeStudy}
      studyPreviews={studyPreviews} sending={sending} generating={sending||submissions.some(job=>job.status==='pending')||runs.some(run=>run.status==='pending')} sent={sent}
      canSend={canSend&&!recoveryUnavailable} missingReferences={missingReferences}
      onStartFresh={recoveryUnavailable&&canSend?()=>void send(true):undefined}
      variation={variation} suggestedVariation={suggestedVariation} isSuggested={!w.variationAxis} pauseStyle={pauseStyle}
      onVariation={variationAxis=>patch({variationAxis})}
      prompt={w.prompt} promptBlocks={promptBlocks} onRemovePromptBlock={removePromptBlock}
      onLocatePromptBlock={id=>board.current?.locate(id)} onReorderPromptBlocks={promptBlockIds=>patch({promptBlockIds})}
      settings={w.settings} styleStore={w.styleStore} parts={parts} checks={rules.filter((r)=>r.check.trim()).map((r)=>r.title)}
      notice={lengthNotice||notice||undefined} highlighted={highlight} onPrompt={(prompt)=>{setSent(false);patch({prompt})}}
      onSettings={(settings)=>patch({settings})} onStyleStore={(styleStore)=>patch({styleStore})}
      onSend={()=>void send()} onRemove={remove}
      onHighlight={setHighlight} onReorder={(ids)=>patch({attachments:ids.filter((id)=>id!==w.target)})}
      onImportExamples={(batch)=>session.runAssetImport(()=>upload(batch))} onGuideMode={(guideMode:GuideMode)=>patch({guideMode})}/>
    {layer?.mode==='edit'&&layerImage&&<Edit key={layer.id} asset={layerImage} guides={w.guides[layer.id]??[]} mode={w.guideMode}
      initialLayer={layer.initialLayer}
      origin={layer.origin} onClose={closeLayer} onChange={(guides,guideMode)=>patch({guides:{...w.guides,[layer.id]:guides},guideMode})}/>}
    {layer?.mode==='review'&&layerImage&&layerRun&&candidate&&<Review key={layer.id} asset={layerImage} assets={assets}
      run={layerRun} candidate={candidate} action={candidateAction} onClose={closeLayer} onRevise={revise}
      onDetails={()=>setDetails(layerRun.id)} origin={layer.origin}/>}
    {projectToOpen&&<ReplaceBoardDialog
      boardName={catalogue.boards.find(({id})=>id===catalogue.activeId)?.name??'this board'} filename={projectToOpen.name}
      onConfirm={()=>openProject(projectToOpen)} onClose={()=>setProjectToOpen(null)}/>}
    {imageToRename&&<RenameImageDialog name={imageToRename.name} trigger={imageToRename.trigger}
      onSave={(name)=>renameImage(imageToRename.id,name)} onClose={()=>setImageToRename(null)}/>}
    {details&&<RunDialog key={details} value={details} runs={runs} assets={assets} onOpen={setDetails} onClose={()=>setDetails(null)}
      onRetry={(run,confirmed)=>void client.retry(run,confirmed).then((next)=>{
        setBoot((prev)=>({...prev,runs:[...prev.runs.filter((r)=>r.id!==next.id),next]}));setDetails(next.id)
      }).catch((e)=>setError(message(e)))} onReview={(id)=>open(id,'review')}/>}
    {(error||saveError)&&<div className="status-toast" role="alert"><span>{error||saveError}</span><button className="btn icon" aria-label="Dismiss message" onClick={()=>{setError('');session.clearSaveError()}}><Icon name="x"/></button></div>}
    <Tooltip frame={frame}/>
  </main>
}
