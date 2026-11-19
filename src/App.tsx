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
import type {BoardList} from './client'
import {guideLayer,guidePercent} from './guides'
import {promptParts,SIZES} from './request.js'
import {activeStyle,effectiveRules,saveStyleVersion} from './styles'
import {candidatePositions,importPositions,itemsFor} from './workspace'
import type {Asset,GuideMode,Run,Workspace} from './model'
import type {Point} from './board-geometry'

type Layer = {id:string; mode:'edit'|'review'; origin?:DOMRect}
const message = (error:unknown)=>error instanceof Error?error.message:String(error)

function withoutAttachments(workspace:Workspace,ids:ReadonlySet<string>):Workspace {
  return {
    ...workspace,
    attachments:workspace.attachments.filter((id)=>!ids.has(id)),
    ...(workspace.target!==null&&ids.has(workspace.target)?{target:null,guideMode:'whole'}:{}),
    ...(workspace.active!==null&&ids.has(workspace.active)?{active:null}:{}),
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
  const {boot,workspace:w,projectVersion,saveError} = useSyncExternalStore(session.subscribe,session.snapshot)
  const {client,setBoot,setWorkspace,refresh} = session
  const [layer,setLayer] = useState<Layer|null>(null)
  const [details,setDetails] = useState<string|null>(null)
  const [projectToOpen,setProjectToOpen] = useState<File|null>(null)
  const [imageToRename,setImageToRename] = useState<{id:string;name:string;trigger:HTMLButtonElement}|null>(null)
  const [highlight,setHighlight] = useState<string|null>(null)
  const [notice,setNotice] = useState('')
  const [error,setError] = useState('')
  const [dragging,setDragging] = useState(false)
  const [showReferences,setShowReferences] = useState(false)
  const referencesButton = useRef<HTMLButtonElement>(null)
  const board = useRef<BoardHandle>(null)
  const frame = useRef<HTMLElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const projectFile = useRef<HTMLInputElement>(null)
  const sendLock = useRef(false)
  const {assets,runs} = boot
  const deletedIds = new Set(w.deletedImageIds)

  const patch = (update:Partial<Workspace>)=>setWorkspace((prev)=>({...prev,...update}))
  const selected = w.target ? [w.target,...w.attachments.filter((x)=>x!==w.target)] : w.attachments
  const items = useMemo(()=>itemsFor(w,assets,runs,boot.demo),[w,assets,runs,boot.demo])
  const positions = useMemo(()=>candidatePositions(runs,assets,w.positions),[runs,assets,w.positions])
  const image = (id:string|null)=>assets.find((a)=>a.id===id)
  const references = (w.referenceIds ?? []).flatMap((id)=>image(id) ?? [])
  const canvasIds = items.filter((item)=>!deletedIds.has(item.id)).map((item)=>item.id)
  const rules = effectiveRules(w.styleStore)
  const style = activeStyle(w.styleStore)
  const parts = promptParts({prompt:w.prompt,inputs:selected.flatMap((id)=>image(id)??[]),target:w.target,
    guideMode:w.guideMode,rules,styleName:style?.name})
  const layerImage = layer && image(layer.id)
  const layerRun = layer && runs.find((r)=>r.candidates.some((c)=>c.id===layer.id))
  const candidate = layerRun?.candidates.find((c)=>c.id===layer?.id)
  const retried = new Set(runs.flatMap((r)=>r.retriedFrom??[]))
  const busy = runs.some((r)=>r.status==='pending'||r.candidates.some((c)=>c.reviewStatus==='pending'))

  useEffect(()=>{
    void refresh().catch((err)=>setError(message(err)))
  },[refresh])

  useEffect(()=>{
    if (!busy) return
    const timer=window.setInterval(()=>void refresh().catch(()=>{}),700)
    return ()=>window.clearInterval(timer)
  },[busy,refresh])

  function attachMany(ids:string[]) {
    const additions=ids.filter((id)=>!selected.includes(id))
    const available=8-selected.length
    const accepted=additions.slice(0,available)
    if (accepted.length) patch({attachments:[...w.attachments,...accepted],active:accepted.at(-1)!})
    setNotice(additions.length>available?`Eight images at most. Remove one to add ${image(additions[available])?.name ?? 'another image'}.`:'')
  }
  function remove(id:string) {
    if (layer?.mode==='edit' && layer.id===id) closeLayer()
    setWorkspace((prev)=>withoutAttachments(prev,new Set([id])))
    setNotice('')
  }
  function deleteSelection(ids:string[],annotations?:Workspace['annotations']) {
    const removedIds = new Set(ids)
    const previous = {attachments:w.attachments,target:w.target,active:w.active,guideMode:w.guideMode,annotations:w.annotations}
    const redo = () => {
      setWorkspace((prev)=>({
        ...withoutAttachments(prev,removedIds),
        ...(ids.length?{deletedImageIds:[...new Set([...(prev.deletedImageIds ?? []),...ids])]}:{}),
        ...(annotations?{annotations}:{}),
      }))
      setHighlight(null)
      setNotice('')
    }
    const undo = () => setWorkspace((prev)=>{
      const restoredIds = new Set(prev.deletedImageIds?.filter((id)=>removedIds.has(id)))
      if (!restoredIds.size && !annotations) return prev
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
        deletedImageIds:prev.deletedImageIds?.filter((id)=>!restoredIds.has(id)),
        ...(annotations?{annotations:previous.annotations}:{}),
      }
    })
    redo()
    return {undo,redo}
  }
  function open(id:string,mode:Layer['mode']) {
    const node=frame.current?.querySelector<HTMLElement>(`.tile[data-id="${CSS.escape(id)}"]`)
    setLayer({id,mode,origin:node?.getBoundingClientRect()})
    setDetails(null)
    if (mode==='edit') {
      if (!selected.includes(id) && selected.length===8) {
        setLayer(null); setNotice('Eight images at most. Remove one to edit this image.'); return
      }
      const guides=w.guides[id]??[]
      const current=guides.filter((g)=>!g.erase).at(-1)
      patch({target:id,guideMode:id===w.target?w.guideMode:current?.layer==='area'?'mask':current?'markup':'whole',
        attachments:w.attachments.filter((x)=>x!==id),active:null})
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

    const redo=()=>setWorkspace((prev)=>({
      ...prev,
      imageIds:[...prev.imageIds,...newIds.filter((id)=>!prev.imageIds.includes(id))],
      deletedImageIds:prev.deletedImageIds?.filter((id)=>!placed.has(id)),
      positions:{...prev.positions,...positions},
      ...(attach?{target:null,guideMode:'whole',attachments:ids,active:ids.at(-1)!}:{}),
    }))
    const undo=()=>setWorkspace((prev)=>{
      const restored={...prev.positions}
      for (const id of ids) {
        if (previousPositions[id]) restored[id]=previousPositions[id]
        else delete restored[id]
      }
      const removedInputs=new Set(ids.filter((id)=>!prev.referenceIds?.includes(id)))
      const inputsUnchanged=attach && prev.target===null && prev.attachments.length===ids.length
        && prev.attachments.every((id,index)=>id===ids[index])
      return {
        ...withoutAttachments(prev,removedInputs),
        imageIds:prev.imageIds.filter((id)=>!added.has(id)),
        positions:restored,
        deletedImageIds:restoredTombstones.length
          ? [...new Set([...(prev.deletedImageIds ?? []),...restoredTombstones])]
          : prev.deletedImageIds,
        ...(inputsUnchanged?previousInputs:{}),
      }
    })
    redo()
    board.current?.recordEdit({undo,redo})
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

  function locateAttachment(id:string) {
    if (id===w.target) open(id,'edit')
    else if (board.current?.getImageRect(id)) board.current.locate(id)
    else if (w.referenceIds?.includes(id)) setShowReferences(true)
  }

  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if (e.key==='Tab') delete document.documentElement.dataset.modality
      if (e.key!=='Escape'||e.defaultPrevented||details||projectToOpen||imageToRename||frame.current?.querySelector('.pop:not([hidden])')) return
      if (!frame.current?.querySelector('#workspace-menu')) closeLayer()
    }
    const paste=(e:ClipboardEvent)=>{
      if (projectToOpen||imageToRename) return
      const batch=Array.from(e.clipboardData?.files??[]).filter((file)=>file.type.startsWith('image/'))
      if (batch.length) { e.preventDefault(); void importBoard(batch) }
    }
    window.addEventListener('keydown',key)
    window.addEventListener('paste',paste)
    return ()=>{window.removeEventListener('keydown',key);window.removeEventListener('paste',paste)}
  })
  async function send() {
    if (sendLock.current||!w.prompt.trim()) return
    sendLock.current=true
    try {
      const target=image(w.target)
      const guide=target?w.guides[target.id]??[]:[]
      const guideMode=target?w.guideMode:'whole'
      let guidePng:string|undefined
      if (target&&guideMode!=='whole') {
        const ctx=guideLayer(guide,guideMode==='mask'?'area':'sketch',target.width,target.height)
        if (guidePercent(ctx)===0) throw new Error(w.guideMode==='mask'?'Paint an edit area before sending.':'Draw a sketch before sending.')
        guidePng=ctx.canvas.toDataURL('image/png').split(',')[1]
      }
      const saved=style&&saveStyleVersion(style)
      const snapshot=saved?{name:saved.name,version:saved.version,rules}:null
      if (saved && saved!==style) setWorkspace((prev)=>({
        ...prev,styleStore:{...prev.styleStore,styles:prev.styleStore.styles.map((s)=>s.id===saved.id?saved:s)},
      }))
      const inputRects=selected.flatMap((id)=>board.current?.getImageRect(id)??[])
      const center=board.current?.center()??{x:48,y:72}
      const [px,py]=SIZES[w.settings.size].split('x').map(Number)
      const sourceRect=inputRects[0]
      const width=sourceRect?.width??176
      const height=target?width*target.height/target.width:width*py/px
      let x=inputRects.length?Math.max(...inputRects.map((r)=>r.x+r.width))+24:center.x-width/2
      const y=sourceRect?.y??center.y-height/2
      const rowWidth=(width+6)*Number(w.settings.count)
      const occupied=[...items.flatMap((i)=>board.current?.getImageRect(i.id)??[]),
        ...runs.filter((r)=>r.status!=='done').map((r)=>({...r.rect,width:(r.rect.width+6)*Number(r.settings.count)}))]
      for (const other of occupied.sort((a,b)=>a.x-b.x)) {
        if (x<other.x+other.width+8 && x+rowWidth+8>other.x && y<other.y+other.height+8 && y+height+8>other.y) x=other.x+other.width+16
      }
      const run=await client.submit({id:crypto.randomUUID(),prompt:w.prompt,inputs:selected,target:w.target,
        guideMode,guide,guidePng,settings:w.settings,style:snapshot,rect:{x,y,width,height}})
      setBoot((prev)=>({...prev,runs:[...prev.runs.filter((r)=>r.id!==run.id),run]}))
      if (Object.keys(w.styleStore.overrides).length) setWorkspace((prev)=>prev.styleStore.overrides===w.styleStore.overrides
        ? {...prev,styleStore:{...prev.styleStore,overrides:{}}}
        : prev)
      if (run.status==='failed'||run.status==='uncertain') setDetails(run.id)
      if (layer?.mode==='edit') closeLayer()
    } catch (err) { setError(message(err)) }
    finally { sendLock.current=false }
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
    patch({target:id,guideMode:layerRun.guideMode,prompt,attachments:refs.slice(0,7),
      guides:{...w.guides,[id]:layerRun.guide},active:null})
    if (refs.length>7) setNotice('The revision has seven references plus its edit target. Remove a reference to restore the eighth.')
    setLayer(null)
    requestAnimationFrame(()=>frame.current?.querySelector<HTMLElement>('#prompt')?.focus())
  }

  async function openProject(file:File) {
    await session.openProject(file)
    setLayer(null);setDetails(null);setError('');setShowReferences(false)
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
    <Board key={projectVersion} ref={board} items={items} positions={positions} deletedImageIds={w.deletedImageIds}
      camera={w.camera} annotations={w.annotations}
      attachments={selected} active={w.active} target={w.target} highlighted={highlight} disabled={!!layer}
      jobs={runs.filter((r)=>r.status!=='done'&&!r.candidates.length&&!retried.has(r.id)).map((r)=>({
        id:r.id,label:r.label,status:r.status,rect:r.rect,onOpen:()=>setDetails(r.id),
      }))}
      onChange={(p)=>patch(p)} onActive={(active)=>patch({active})} onHighlight={setHighlight}
      onToggle={(id)=>selected.includes(id)?remove(id):attachMany([id])} onAttachMany={attachMany}
      onEdit={(id)=>open(id,'edit')} onRename={showRenameImage} onDelete={deleteSelection} onReview={(id)=>open(id,'review')} onFlatten={(file,point)=>importBoard([file],point,true)}/>
    {items.every((item)=>deletedIds.has(item.id))&&!w.annotations.length&&!runs.length&&<button type="button" className="btn lead empty-import" onClick={()=>files.current?.click()}><Icon name="upload"/>Import images</button>}
    <div className="frame-navigation" inert={!!layer || undefined}>
      <button ref={referencesButton} className="btn" type="button" aria-haspopup="dialog"
        aria-expanded={showReferences} onClick={()=>setShowReferences(!showReferences)}>References</button>
      <button className="btn lead import" type="button" onClick={()=>files.current?.click()} data-tip="Or drop images anywhere"><Icon name="upload"/>Import</button>
      <WorkspaceMenu catalogue={catalogue} focusOnMount={focusWorkspace} onSelect={onBoardSelect} onCreate={onBoardCreate} onRename={onBoardRename} onSetArchived={onBoardSetArchived}
        onRuns={()=>setDetails('all')} onOpenProject={()=>projectFile.current?.click()}
        onExport={()=>void session.flush().then(()=>{
          const link=document.createElement('a')
          link.href=client.exportUrl;link.download='charcoal-project.json';link.click()
        }).catch((err)=>setError(message(err)))}/>
    </div>
    {showReferences && !layer && <ReferenceLibrary assets={references} attachedIds={selected} canvasIds={canvasIds}
      onUpload={uploadReferences} onAttach={(id)=>selected.includes(id)?remove(id):attachMany([id])}
      onPlace={placeReference} onRename={showRenameImage} onRemove={removeReference} onClose={()=>setShowReferences(false)} triggerRef={referencesButton}/>}
    <input type="file" ref={files} aria-label="Import images" accept="image/*" multiple hidden onChange={(e)=>{void importBoard(Array.from(e.target.files??[]));e.target.value=''}}/>
    <input type="file" ref={projectFile} aria-label="Open project" accept="application/json,.json" hidden onChange={(e)=>{
      const file=e.target.files?.[0]
      if (file) setProjectToOpen(file)
      e.target.value=''
    }}/>
    <Composer assets={assets} attachments={selected} target={w.target} guideMode={w.guideMode}
      prompt={w.prompt} settings={w.settings} styleStore={w.styleStore} parts={parts} checks={rules.filter((r)=>r.check.trim()).map((r)=>r.title)}
      notice={notice||undefined} highlighted={highlight} onPrompt={(prompt)=>patch({prompt})}
      onSettings={(settings)=>patch({settings})} onStyleStore={(styleStore)=>patch({styleStore})}
      onSend={()=>void send()} onRemove={remove} onLocate={locateAttachment}
      onHighlight={setHighlight} onReorder={(ids)=>patch({attachments:ids.filter((id)=>id!==w.target)})}
      onImportExamples={(batch)=>session.runAssetImport(()=>upload(batch))} onGuideMode={(guideMode:GuideMode)=>patch({guideMode})}/>
    {layer?.mode==='edit'&&layerImage&&<Edit key={layer.id} asset={layerImage} guides={w.guides[layer.id]??[]} mode={w.guideMode}
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
