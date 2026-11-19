import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {encodeRgba} from '../server/assets.mjs'

assert.ok(process.env.OPENAI_API_KEY,'Set OPENAI_API_KEY before running the live smoke test.')
const work=await mkdtemp(join(tmpdir(),'charcoal-live-'))
const port=process.env.CHARCOAL_LIVE_PORT ?? '4321'
const url=`http://127.0.0.1:${port}/api`
const service=spawn(process.execPath,['server/index.mjs'],{
  env:{...process.env,CHARCOAL_DEMO:'1',CHARCOAL_FIXTURE:'0',CHARCOAL_DATA_DIR:work,CHARCOAL_PORT:port},
  stdio:['ignore','pipe','inherit'],
})
const stroke={layer:'area',size:.09,pts:[[.72,.25],[.86,.35]]}
async function result(path, data) {
  const response=await fetch(url+path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:undefined)
  const body=await response.json()
  assert.ok(response.ok,body.error)
  return body
}
function delay(ms){return new Promise((r)=>setTimeout(r,ms))}
try {
  await new Promise((resolve,reject)=>{
    service.stdout.on('data',(c)=>{if(String(c).includes('Charcoal on')) resolve()})
    service.once('exit',(code)=>reject(new Error(`Local service exited (${code}).`)))
  })
  const boot=await result('/state')
  assert.equal(boot.provider,'live')
  const source=boot.assets.find((a)=>a.id==='s1')
  const guideBytes=Buffer.alloc(source.width*source.height*4)
  for(let y=Math.floor(source.height*.18);y<source.height*.42;y++) {
    for(let x=Math.floor(source.width*.66);x<source.width*.90;x++) guideBytes[(y*source.width+x)*4+3]=255
  }
  const guidePng=(await encodeRgba(guideBytes,source.width,source.height)).toString('base64')
  const drafts=[
    ['Text only',{inputs:[],target:null,guideMode:'whole',prompt:'Illustrate a paper-cut hill and a winding path in two muted colors.'}],
    ['Multiple references',{inputs:['walkers','leaves'],target:null,guideMode:'whole',prompt:'Create a paper-cut walker among leaves. Use image 1 for figure shapes and image 2 for foliage.'}],
    ['Protected mask',{inputs:['s1','leaves'],target:'s1',guideMode:'mask',guide:[stroke],guidePng,
      prompt:'In the painted area, replace the fine branches with two muted green leaf shapes.',
      style:{name:'Live smoke',version:1,rules:[{id:'foliage',title:'Foliage count',on:true,prompt:'',
        check:'Describe whether the foliage in the top right consists of two broad leaves.',ex:[]}]} }],
    ['Markup',{inputs:['s1'],target:'s1',guideMode:'markup',guide:[{...stroke,layer:'sketch'}],guidePng,
      prompt:'Place two simple rust-colored leaves where the markup appears.'}],
  ]
  const records=await Promise.all(drafts.map(async ([name,patch],i)=>{
    await delay(i*500)
    const run=await result('/runs',{id:randomUUID(),guide:[],settings:{quality:'Low',complexity:'Low',size:'Square',count:'1'},
      rect:{x:40+i*180,y:40,width:160,height:160},...patch})
    console.log(`${name}: submitted`)
    return [name,run.id]
  }))
  const outstanding=new Map(records.map(([name,id])=>[id,name]))
  let failed=false
  const deadline=Date.now()+420000
  while(outstanding.size && Date.now()<deadline) {
    const {runs}=await result('/runs')
    for(const r of runs) {
      if(!outstanding.has(r.id)||r.status==='pending'||r.candidates.some((c)=>c.reviewStatus==='pending')) continue
      const name=outstanding.get(r.id)
      outstanding.delete(r.id)
      if(r.status!=='done'||r.candidates.some((c)=>c.reviewStatus==='failed')) {
        failed=true
        console.log(`${name}: ${r.status}; ${r.error ?? r.candidates.find((c)=>c.reviewError)?.reviewError ?? 'review unavailable'}`)
      } else {
        console.log(`${name}: passed; ${r.candidates.length} image(s); checks: ${r.candidates.flatMap((c)=>c.checks).map((c)=>c.title+' '+c.status).join(', ') || 'none'}`)
        if(name==='Protected mask') assert.equal(r.candidates[0]?.checks.find((c)=>c.id==='pixel')?.status,'pass')
      }
    }
    if(outstanding.size) await delay(1800)
  }
  assert.equal(outstanding.size,0,`Timed out: ${[...outstanding.values()].join(', ')}`)
  if(failed) process.exitCode=1
} finally {
  if(service.exitCode===null){
    const stop=new Promise((resolve)=>service.once('exit',resolve))
    service.kill()
    await stop
  }
  await rm(work,{recursive:true,force:true})
}
