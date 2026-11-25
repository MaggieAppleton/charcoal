import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {openStore} from '../server/store.mjs'

const work=await mkdtemp('/tmp/charcoal-batch-recovery-')
const port=process.env.CHARCOAL_TEST_PORT??'4390'
const url='http://127.0.0.1:'+port
let board,service,browser
async function api(path,method='GET',body) {
  const address=new URL('/api/'+path,url)
  if(board)address.searchParams.set('board',board)
  const response=await fetch(address,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
  assert.equal(response.ok,true,await response.clone().text())
  return response.json()
}
async function until(predicate) {
  for(let tries=0;tries<240;tries++) {
    const result=await predicate()
    if(result)return result
    await delay(75)
  }
  assert.fail('Timed out waiting for batch recovery state')
}

try {
  service=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,CHARCOAL_PORT:port,
    CHARCOAL_DATA_DIR:work,CHARCOAL_FIXTURE:'1',CHARCOAL_DEMO:'1'},stdio:['ignore','pipe','pipe']})
  await new Promise((resolve,reject)=>{
    let errors=''
    service.stderr.on('data',chunk=>{errors+=chunk})
    service.stdout.on('data',chunk=>{if(String(chunk).includes('Charcoal on'))resolve()})
    service.once('exit',()=>reject(new Error(errors)))
  })
  browser=await chromium.launch({channel:'chrome'})
  const page=await browser.newPage({reducedMotion:'reduce'})
  const send=page.locator('#send')
  const editor=page.getByRole('textbox',{name:'Prompt',exact:true})
  const attempts=[],plans=[],recoveries=[],errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/composition-plans?*',route=>{
    const request=route.request()
    if(request.method()==='POST')plans.push(request.postDataJSON())
    else recoveries.push(new URL(request.url()).searchParams.get('id'))
    return route.continue()
  })
  let failSecond=false
  let index=0
  await page.route('**/api/runs?*',route=>{
    const request=route.request()
    if(request.method()==='POST') {
      attempts.push(request.postDataJSON())
      if(failSecond && ++index===2) {
        failSecond=false
        return route.fulfill({status:503,json:{error:'Fixture second submission failed.'}})
      }
    }
    return route.continue()
  })
  const workspace=() => api('state').then(state=>state.workspace)
  const runs=() => api('runs').then(state=>state.runs)
  const waitForDone=ids=>until(async()=>{
    const current=await runs()
    return ids.every(id=>current.some(run=>run.id===id&&run.status==='done')) && current
  })
  await page.goto(url)
  await send.waitFor()
  const initial=await until(workspace)
  const emptyEdit={...initial,target:'layout',guideMode:'whole',prompt:'',settings:{...initial.settings,count:'2'},
    styleStore:{...initial.styleStore,activeId:null}}
  await api('workspace','PUT',emptyEdit)
  await page.reload()
  assert.equal(await send.isDisabled(),true)
  await editor.press('Enter')
  assert.equal(await page.locator('[data-board-job]').count(),0)
  assert.equal(plans.length,0)
  assert.equal(attempts.length,0)

  // An empty editor can still send the literal text from a linked canvas block.
  const block={id:'linked-brief',kind:'note',promptBlock:true,points:[{x:60,y:60}],text:'Keep the layout and use soft graphite.'}
  const draft={...emptyEdit,target:null,studyMode:'composition',attachments:['layout'],
    annotations:[block],promptBlockIds:[block.id]}
  async function partial(update) {
    await api('workspace','PUT',{...draft,...update,pendingSubmission:undefined})
    await page.reload()
    index=0
    failSecond=true
    await send.click()
    await page.getByRole('alert').filter({hasText:'Fixture second submission failed.'}).waitFor()
    const ids=(await workspace()).pendingSubmission.ids
    await waitForDone(ids.slice(0,1))
    return ids
  }
  const current=await partial({})
  assert.equal(plans[0].userBrief,block.text)
  assert.match(plans[0].prompt,/black-and-white \(grayscale\)/)
  assert.ok(attempts.slice(0,2).every(attempt=>attempt.prompt.includes('black-and-white (grayscale)')))
  await page.reload()
  await send.click()
  await waitForDone(current)
  assert.deepEqual(recoveries,[current[0]])
  assert.deepEqual(attempts.map(run=>run.id),[...current,current[1]])
  assert.equal(plans.length,1)

  const legacy=await partial({prompt:'Add fine crosshatching.'})
  const pending=await workspace()
  const exported=await api('project')
  const longBrief='Preserve every line of the sketch. '.repeat(600)
  // Seed the historical renderer's individual assignment in the temporary board.
  const historicalText='Keep the line weights from “old-source.png” exactly as drawn.'
  const fixtureStore=openStore(work)
  try {
    const key='composition-plan:'+legacy[0]
    const cached=fixtureStore.get(key)
    cached.plan.alternatives[1].renderPrompt=historicalText
    fixtureStore.set(key,cached)
  } finally {
    fixtureStore.close()
  }
  const fingerprint=JSON.stringify({...JSON.parse(pending.pendingSubmission.fingerprint),contractVersion:3,prompt:longBrief})
  await api('workspace','PUT',{...pending,prompt:longBrief,pendingSubmission:{...pending.pendingSubmission,fingerprint}})
  await page.reload()
  await send.click()
  await waitForDone(legacy)
  assert.deepEqual(recoveries,[current[0],legacy[0]])
  assert.deepEqual(attempts.slice(3).map(run=>run.id),[...legacy,legacy[1]])
  assert.equal(plans.length,2)

  assert.equal(attempts.at(-1).prompt.split('\n\n')[0],historicalText,'preserve verbatim historical directions')
  assert.deepEqual((await runs()).find(run=>run.id===legacy[0]).prompt,attempts[3].prompt)
  await page.reload()
  assert.equal(await send.isDisabled(),true,'a completed batch would need new planning')
  const fresh=page.getByRole('button',{name:'Start new batch',exact:true})
  async function checkImport(bundle,expectedIds) {
    const before=[plans.length,attempts.length]
    const imported=await api('project','POST',bundle)
    assert.equal(imported.workspace.pendingSubmission.recoveryOnly,true)
    for(const id of expectedIds)assert.ok(imported.runs.some(run=>run.id===id&&run.status==='done'))
    for(let visit=0;visit<2;visit++) {
      await page.reload()
      await send.click()
      await fresh.waitFor()
      assert.equal(await send.isDisabled(),true)
      assert.deepEqual([plans.length,attempts.length],before)
    }
  }
  const missingWithPlan=structuredClone(exported)
  missingWithPlan.workspace.pendingSubmission.ids[1]='missing-with-local-plan'
  await checkImport(missingWithPlan,[legacy[0]])
  await checkImport(exported,legacy)
  const {id}=await api('boards','POST',{name:'Imported batch fixture'})
  await api('boards/'+id,'PATCH',{active:true})
  board=id
  await checkImport(exported,[legacy[0]])
  assert.match(await fresh.locator('..').innerText(),/may incur additional charges/)
  assert.equal(plans.length,2)
  assert.equal(attempts.length,6)
  const accepted=(await runs()).find(run=>run.id===legacy[0])
  assert.equal((await runs()).some(run=>run.id===legacy[1]),false)
  await fresh.click()
  const restarted=await until(async()=>{
    const state=await workspace()
    return state.pendingSubmission.ids[0]!==legacy[0]&&state.pendingSubmission.ids
  })
  await waitForDone(restarted)
  assert.equal(plans.length,3)
  assert.equal(attempts.length,8)
  assert.ok(restarted.every(id=>!legacy.includes(id)))
  assert.deepEqual((await runs()).find(run=>run.id===legacy[0]),accepted)
  const importedDraft=await workspace()
  const imageOnly={...importedDraft,prompt:'[[image:layout]]',promptBlockIds:[],
    pendingSubmission:undefined,settings:{...importedDraft.settings,count:'1'}}
  await api('workspace','PUT',{...imageOnly,studyMode:'illustration'})
  await page.reload()
  assert.equal(await send.isDisabled(),true,'a bare attachment does not direct an ordinary illustration')
  await api('workspace','PUT',{...imageOnly,studyMode:'composition'})
  await page.reload()
  await send.click()
  await until(()=>attempts.length===9)
  await waitForDone([attempts.at(-1).id])
  assert.equal(plans.length,3,'a single reference-led study needs no planner')
  assert.match(attempts.at(-1).prompt,/black-and-white \(grayscale\)/)
  const single=await api('project')
  const singleId=single.workspace.pendingSubmission.ids[0]
  const singleOutputIds=new Set(single.runs.find(run=>run.id===singleId).candidates.flatMap(c=>[c.id,c.rawId]))
  single.runs=single.runs.filter(run=>run.id!==singleId)
  single.assets=single.assets.filter(asset=>!singleOutputIds.has(asset.id))
  await checkImport(single,[singleId])
  const another=await api('boards','POST',{name:'Single import fixture'})
  await api('boards/'+another.id,'PATCH',{active:true})
  board=another.id
  await checkImport(single,[])
  const rejected=await fetch(url+'/api/runs?board='+board,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(attempts.at(-1))})
  assert.equal(rejected.status,409)
  await fresh.click()
  await until(()=>attempts.length===10)
  assert.notEqual(attempts.at(-1).id,singleId)
  await waitForDone([attempts.at(-1).id])
  assert.equal(plans.length,3)
  assert.deepEqual(errors,[])
  console.log('Batch recovery passed: empty edit gating, linked brief, grayscale with styles off, current and long v3 partial recovery, same-board and fresh-board single/multi imports across reloads, durable outputs and explicit restart.')
}finally{
  await browser?.close()
  service?.kill('SIGTERM')
  await rm(work,{recursive:true,force:true})
}
