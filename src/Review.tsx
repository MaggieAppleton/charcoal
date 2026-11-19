import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Accordion} from '@base-ui/react/accordion'
import {segmentKeys} from './segmented'
import {Icon} from './Icon.js'
import {ImageStage} from './ImageStage'
import {guideLayer,paintPreview} from './guides'
import type {Asset,Candidate,Check,Guide,Run} from './model'

export type CandidateAction = {kind:'seen'|'keep'|'review'} | {kind:'override',checkId:string,reason:string}

export function Review({asset,assets,run,candidate,action,onClose,onRevise,onDetails,origin}:{
  asset:Asset; assets:Asset[]; run:Run; candidate:Candidate
  action:(a:CandidateAction)=>Promise<void>
  onClose:()=>void; onRevise:(prompt:string)=>void; onDetails:()=>void; origin?:DOMRect
}) {
  const [comparing,setComparing] = useState(false)
  const [showArea,setShowArea] = useState(true)
  const [open,setOpen] = useState<string[]>([])
  const first = useRef<HTMLDivElement>(null)
  const source = assets.find((a)=>a.id===run.target)
  const pixel = candidate.checks.find((c)=>c.id==='pixel')
  const visual = candidate.checks.filter((c)=>c.id!=='pixel')
  const pending = candidate.reviewStatus==='pending'
  const issues = candidate.checks.filter((c)=>c.status!=='pass' && !c.override).length
  const protection = run.guideMode==='mask'
  const location = visual.find((c)=>c.id===open[0])?.loc
  useEffect(() => {
    const trigger=first.current?.querySelector<HTMLElement>('.ck-row') ?? first.current?.querySelector<HTMLElement>('.link, .btn')
    trigger?.focus({preventScroll:true})
  },[])

  const row = (check:Check) => <CheckRow key={check.id} check={check} asset={asset} source={source}
    examples={(run.style?.rules.find((r)=>r.id===check.id)?.ex ?? []).flatMap((e)=>{
      const image=assets.find((a)=>a.id===e.id)
      return image ? [{...e,asset:image}] : []
    })} pending={pending} action={action} onRevise={onRevise}/>
  const panel = <aside className="review" aria-label="Review" ref={first}>
    <div className="rv-head">
      <div className="rv-title">{asset.name.replace(/\.png$/i,'')}</div>
      {source && <button className="link" type="button" onClick={()=>setComparing(!comparing)}>Edited from {source.name}</button>}
    </div>
    <Accordion.Root value={open} onValueChange={(values)=>{setOpen(values); if(values.includes('pixel')) setShowArea(true)}}>
      {pixel && row(pixel)}
      {run.style && <div className="rv-sub">{run.style.name}<span className="muted">Version {run.style.version}</span></div>}
      {visual.map(row)}
    </Accordion.Root>
    {candidate.reviewError && <div className="review-error">
      <p className="note" role="alert">{candidate.reviewError}</p>
      <button className="btn" onClick={()=>void action({kind:'review'}).catch(()=>{})}>Rerun checks</button>
    </div>}
    <div className="rv-foot">
      {candidate.kept ? <a className="btn lead" href={asset.originalUrl} download><Icon name="download"/>Export image</a>
        : <button type="button" className="btn primary" disabled={issues>0 || pending}
          onClick={()=>void action({kind:'keep'}).catch(()=>{})}>Keep</button>}
      <span className="muted">{pending ? 'Checking…' : issues ? `${issues} to look at` : candidate.checks.length ? 'All checks passed' : ''}</span>
      <button className="btn icon review-more" type="button" onClick={onDetails} aria-label="Run record" data-tip="Run record"><Icon name="doc"/></button>
    </div>
    {candidate.kept && <div className="rv-foot"><button className="btn" type="button" onClick={()=>onRevise(run.prompt)}>Revise</button></div>}
  </aside>
  const tools = <div className="tools" role="toolbar" aria-label="Compare">
    {source && <div className="seg" role="radiogroup" aria-label="Show" onKeyDown={segmentKeys}>
      <button role="radio" type="button" aria-checked={!comparing} tabIndex={(!comparing)?0:-1} onClick={()=>setComparing(false)}>Result</button>
      <button role="radio" type="button" aria-checked={comparing} tabIndex={(comparing)?0:-1} onClick={()=>setComparing(true)}>Source</button>
    </div>}
    {protection && <button className="btn lead" type="button" aria-pressed={showArea} onClick={()=>setShowArea(!showArea)}><Icon name="brush"/>Edit area</button>}
    {source && <span className="sep"/>}
    <button className="btn icon" type="button" onClick={onClose} aria-label="Close" data-tip="Close (Esc)"><Icon name="x"/></button>
  </div>
  return <ImageStage asset={asset} source={comparing?source:undefined} tools={tools}
    readout={comparing?<><b>{source?.name}</b> before the edit</>:<b>{asset.name.replace(/\.png$/i,'')}</b>}
    panel={panel} onClose={onClose} origin={origin}>
    {(width,height)=><ReviewOverlay width={width} height={height} location={comparing?undefined:location}
      guide={run.guide} showArea={showArea&&protection}/>}
  </ImageStage>
}

function CheckRow({check,asset,source,examples,pending,action,onRevise}:{
  check:Check; asset:Asset; source?:Asset; examples:{asset:Asset;kind:string;area?:[number,number,number,number]}[]
  pending:boolean; action:(action:CandidateAction)=>Promise<void>; onRevise:(prompt:string)=>void
}) {
  const [reason,setReason] = useState('')
  const [overriding,setOverriding] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const status = check.override ? 'pass' : check.status
  const word = check.override ? 'Fine' : check.id === 'pixel' ? 'Unchanged' : {pass:'Passed',warn:'Look again',fail:'Failed'}[status]
  return <Accordion.Item value={check.id} className="ck" data-ck={check.id}>
    <Accordion.Header className="check-heading">
      <Accordion.Trigger className="ck-row" ref={trigger}>
        <span className={`ico st-${status}`}><Icon name={{pass:'checkCircle',warn:'alertCircle',fail:'xCircle'}[status]}/></span>
        <span>{check.title}</span><span className={`ck-word st-${status}`}>{word}</span>
        <span className="chev"><Icon name="chevRight"/></span>
      </Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Panel className="disclosure-panel">
      <div className="ck-body">
        <p>{check.obs}</p>
        {check.override && <p className="note">Your call: {check.override}</p>}
        {check.id!=='pixel' && <div className="exs">
          {source && <Evidence asset={source} title="Before" subtitle={Array.isArray(check.loc)?'Same area':'Thumbnail size'}
            crop={Array.isArray(check.loc)?check.loc:undefined}/>}
          <Evidence asset={asset} title="This result" subtitle={Array.isArray(check.loc)?'Checked area':'Thumbnail size'} crop={Array.isArray(check.loc)?check.loc:undefined}/>
          {examples.map((ex,i)=><Evidence key={i} asset={ex.asset} title={ex.kind} subtitle={ex.asset.name} crop={ex.area}/>)}
        </div>}
        {status!=='pass' && !pending && (overriding
          ? <form className="ovr" onSubmit={(e)=>{
            e.preventDefault()
            void action({kind:'override',checkId:check.id,reason}).then(()=>{setOverriding(false);trigger.current?.focus()}).catch(()=>{})
          }}>
            <textarea required autoFocus rows={2} aria-label="Why it works" placeholder="Why it works" value={reason} onChange={(e)=>setReason(e.target.value)}/>
            <div className="acts">
              <button className="btn primary" disabled={!reason.trim()}>Save</button>
              <button className="btn" type="button" onClick={()=>{setOverriding(false);trigger.current?.focus()}}>Cancel</button>
            </div>
          </form>
          : <div className="ck-acts">
            <button className="btn" type="button" onClick={()=>onRevise(check.revise ?? `Revise the illustration to address ${check.title.toLowerCase()}: ${check.obs}`)}>Revise</button>
            <button className="btn" type="button" onClick={()=>{setReason('');setOverriding(true)}}>It's fine</button>
          </div>)}
      </div>
    </Accordion.Panel>
  </Accordion.Item>
}

function Evidence({asset,title,subtitle,crop}:{asset:Asset;title:string;subtitle:string;crop?:[number,number,number,number]}) {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const image = new Image()
    image.onload = ()=>{
      const ctx = cv.current?.getContext('2d')
      if (!ctx) return
      const [x,y,w,h] = crop ?? [0,0,1,1]
      const sw=image.width*w, sh=image.height*h
      const scale=Math.max(176/sw,100/sh)
      const dw=sw*scale, dh=sh*scale
      ctx.clearRect(0,0,176,100)
      ctx.drawImage(image,image.width*x,image.height*y,sw,sh,(176-dw)/2,(100-dh)/2,dw,dh)
    }
    image.src=asset.url
    return ()=>{image.onload=null}
  },[asset.url,crop])
  return <figure className="ex"><canvas ref={cv} width={176} height={100} aria-label={`${title}: ${subtitle}`}/>
    <figcaption><b>{title}</b>{subtitle}</figcaption></figure>
}

function ReviewOverlay({guide,showArea,width,height,location}:{
  guide:Guide[];showArea:boolean;width:number;height:number;location?:Check['loc']
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(()=>{
    const context = ref.current!.getContext('2d')!
    const {width,height} = context.canvas
    context.clearRect(0,0,width,height)
    if (showArea) {
      const scale = Math.min(960 / width, 960 / height)
      paintPreview(context,guideLayer(guide,'area',Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))),undefined,.28)
    }
    if (Array.isArray(location)) {
      const [x,y,w,h] = location
      context.beginPath()
      context.roundRect(x*width,y*height,w*width,h*height,5)
      context.lineWidth=4
      context.strokeStyle='#fff'
      context.stroke()
      context.strokeStyle='#a96400'
      context.lineWidth=2
      context.stroke()
    }
  },[guide,showArea,width,height,location])
  return <canvas ref={ref} className="review-overlay" width={Math.round(width*devicePixelRatio)} height={Math.round(height*devicePixelRatio)} aria-hidden="true"/>
}
