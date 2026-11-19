import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as pause} from 'node:timers/promises'
import {test} from 'node:test'
import {decodeRgba, encodeRgba, importAsset, normalizedSize} from '../server/assets.mjs'
import {createJobs} from '../server/jobs.mjs'
import {prepareRegional, unframe} from '../server/pixels.mjs'
import {openAIProviders} from '../server/providers.mjs'
import {openStore} from '../server/store.mjs'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(),'charcoal-jobs-'))
  const store = openStore(dir)
  t.after(async () => {
    store.close()
    await rm(dir,{force:true,recursive:true})
  })
  return store
}

function draft(id,extra={}) {
  return {id,prompt:'Draw two leaves',inputs:[],target:null,guide:[],guideMode:'whole',
    settings:{quality:'Low',complexity:'Low',count:'1',size:'Square'},
    rect:{x:0,y:0,width:176,height:99},...extra}
}

async function until(condition) {
  const limit = Date.now()+5000
  while (!condition()) {
    if (Date.now() > limit) throw new Error('The fixture job did not reach the expected state.')
    await pause(2)
  }
}

test('ordinary RGB responses preserve the original bytes and per-candidate updates survive later results', async (t) => {
  const store = await setup(t)
  const rgba = await encodeRgba(Buffer.alloc(16,255),2,2)
  const art = execFileSync('magick',['png:-','-alpha','off','PNG24:-'],{input:rgba})
  assert.equal(art[25],2)
  let requests = 0
  const jobs = createJobs(store,'fixture',{generate:async()=>{ requests++; return {images:[art,art]} }})
  const run = draft('multiple',{settings:{...draft('unused').settings,count:'2'}})
  jobs.submit(run)
  jobs.submit(run)
  await until(() => jobs.get('multiple').candidates.length === 1)
  jobs.updateCandidate('multiple','multiple-out-1',{kind:'seen'})
  await until(() => !jobs.busy)
  const saved = jobs.get('multiple')
  assert.equal(requests,1)
  assert.equal(saved.status,'done')
  assert.equal(saved.candidates.length,2)
  assert.equal(saved.candidates[0].seen,true)
  assert.deepEqual(store.readAsset(saved.candidates[0].id,'original').bytes,art)
  assert.equal(store.readAsset(saved.candidates[0].id).bytes[25],6)
})

test('fully erased mask stops before dispatch', async (t) => {
  const store = await setup(t)
  const source = await encodeRgba(Buffer.alloc(24,255),3,2)
  const mask = await encodeRgba(Buffer.alloc(24),3,2)
  await importAsset(store,{name:'Reference',bytes:source},{id:'source',normalized:true})
  let requests = 0
  const jobs = createJobs(store,'live',{generate:async()=>{ requests++; return {images:[source]} }})
  jobs.submit(draft('empty',{inputs:['source'],target:'source',guideMode:'mask',guidePng:mask.toString('base64')}))
  await until(() => !jobs.busy)
  assert.equal(requests,0)
  assert.equal(jobs.get('empty').status,'failed')
  assert.equal(jobs.get('empty').retryNeedsConfirmation,false)
  assert.match(jobs.get('empty').error,/edit area is empty/)
})

test('unalignable variations retain raw files, later candidates, and require explicit live retry confirmation', async (t) => {
  const store = await setup(t)
  const source = await encodeRgba(Buffer.alloc(24,255),3,2)
  const mask = await encodeRgba(Buffer.from([0,0,0,255,...Array(20).fill(0)]),3,2)
  await importAsset(store,{name:'Reference',bytes:source},{id:'source',normalized:true})
  const prompts = []
  const jobs = createJobs(store,'live',{generate:async(request, __, regional)=>{
    prompts.push(request.effectivePrompt)
    return {images:[source,regional.first]}
  }})
  jobs.submit(draft('regional',{inputs:['source'],target:'source',guideMode:'mask',guidePng:mask.toString('base64'),
    settings:{...draft('unused').settings,count:'2'}}))
  await until(() => !jobs.busy)
  const run = jobs.get('regional')
  assert.equal(run.status,'failed')
  assert.equal(run.retryNeedsConfirmation,true)
  assert.match(run.error,/different image size/)
  assert.deepEqual(run.rawIds,['regional-raw-1','regional-raw-2'])
  assert.deepEqual(run.candidates.map((candidate) => candidate.id),['regional-out-2'])
  assert.equal(run.candidates[0].checks[0].id,'pixel')
  assert.throws(()=>jobs.retry(run.id,'retry',false),/Confirm/)
  store.renameAsset('source','Renamed reference')
  assert.equal(jobs.retry(run.id,'retry',true).id,'retry')
  assert.equal(jobs.retry(run.id,'retry-again',true).id,'retry')
  await until(() => !jobs.busy)
  assert.deepEqual(prompts,[run.effectivePrompt,run.effectivePrompt])
})

test('reopening interrupted records exposes unreconciled criteria and blocks Keep', async (t) => {
  const store = await setup(t)
  const art = await encodeRgba(Buffer.alloc(16,255),2,2)
  await importAsset(store,{name:'Reference',bytes:art},{id:'candidate',normalized:true})
  const jobs = createJobs(store,'live',null)
  const rule = {id:'contrast',title:'Focal contrast',on:true,check:'Contrast has one focal point.',prompt:'',ex:[]}
  store.set('runs',[{...draft('interrupted'),status:'pending',dispatched:true,provider:'live',
    style:{name:'Test',version:1,rules:[rule]}, candidates:[{id:'candidate',rawId:'candidate',checks:[],reviewStatus:'pending'}]}])
  jobs.recovery()
  const run = jobs.get('interrupted')
  assert.equal(run.status,'uncertain')
  assert.equal(run.candidates[0].reviewStatus,'failed')
  assert.equal(run.candidates[0].checks[0].status,'warn')
  assert.throws(()=>jobs.updateCandidate(run.id,'candidate',{kind:'keep'}),/Resolve or override/)
})

test('rerunning an imported review requires the configured model', async (t) => {
  const store = await setup(t)
  let checks = 0
  const jobs = createJobs(store,'live',{reviewer:{model:'configured-model'},check:async()=>{ checks++ }})
  store.set('runs',[{...draft('imported'),status:'done',provider:'live',
    reviewer:{model:'other-model',instruction:'Stored instruction'},
    candidates:[{id:'candidate',rawId:'candidate',checks:[],reviewStatus:'done'}]}])
  assert.throws(()=>jobs.updateCandidate('imported','candidate',{kind:'review'}),/different review model/)
  assert.equal(checks,0)
})

test('mask mapping preserves non-square source RGBA bytes including transparent pixels', async () => {
  const width = 7
  const height = 3
  const source = Buffer.from(Array.from({length:width*height*4},(_,i) => (i*17)%256))
  source[3] = 0
  const mask = Buffer.alloc(source.length)
  mask[4*10+3] = 255
  const edit = await prepareRegional(await encodeRgba(source,width,height),await encodeRgba(mask,width,height),'mask',96,96)
  const raw = await encodeRgba(Buffer.alloc(96*96*4,255),96,96)
  const result = await unframe(raw,edit,true)
  const {data} = await decodeRgba(result.bytes)
  assert.equal(result.exactPixels,20)
  for (let i = 0; i < source.length; i += 4) {
    if (mask[i+3]) assert.notDeepEqual(data.subarray(i,i+4),source.subarray(i,i+4))
    else assert.deepEqual(data.subarray(i,i+4),source.subarray(i,i+4))
  }
})

test('review sends the frozen instructions and crop without exposing failed credentials', async (t) => {
  const art = await encodeRgba(Buffer.alloc(8*4*4,255),8,4)
  const engine = openAIProviders('test-only-credential')
  const calls = []
  t.mock.method(globalThis,'fetch',async (url,request) => {
    calls.push({url,body:JSON.parse(request.body)})
    if (calls.length > 1) {
      return Response.json({error:{message:'Invalid key test-only-credential'}},{status:401})
    }
    const judgment = {status:'pass',obs:'The focal shape reads clearly.',loc:[.25,0,.25,.5],revise:null}
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(judgment)}]}]})
  })
  const rule = {id:'fig',title:'Figure',check:'Focal shape reads at thumbnail size'}
  const examples = [{kind:'Focal area',area:[.25,0,.25,.5],bytes:art}]
  const reviewer = {model:'frozen-review-model',instruction:'Frozen default.'}
  const result = await engine.check(rule,art,examples,reviewer)
  assert.equal(result.status,'pass')
  assert.equal(calls[0].body.model,reviewer.model)
  const content = calls[0].body.input[0].content
  assert.match(content[0].text,/Frozen default.*\nRule: Figure\nCriterion:/)
  const crop = Buffer.from(content.at(-1).image_url.split(',')[1],'base64')
  assert.deepEqual(normalizedSize(crop),{width:2,height:2})
  await assert.rejects(engine.check(rule,art,examples,reviewer),{message:'OpenAI (401): Check the API key and project access configured in the local service.'})
})
