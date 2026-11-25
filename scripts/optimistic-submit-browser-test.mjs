import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'

const work=await mkdtemp(join(tmpdir(),'charcoal-optimistic-references-'))
const url=`http://127.0.0.1:${process.env.CHARCOAL_TEST_PORT??4354}`
let service,browser,page
const api=async(path='/state',options)=>{
  const response=await fetch(url+'/api'+path,options)
  assert.equal(response.ok,true,await response.clone().text())
  return response.json()
}
async function until(predicate){
  const started=Date.now()
  while(Date.now()-started<15000){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60))}
  assert.fail('Timed out waiting for optimistic submission state')
}
try{
  service=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,CHARCOAL_PORT:new URL(url).port,
    CHARCOAL_DEMO:'1',CHARCOAL_FIXTURE:'1',CHARCOAL_DATA_DIR:work},stdio:['ignore','pipe','pipe']})
  await new Promise((resolve,reject)=>{
    let log=''
    service.stderr.on('data',chunk=>log+=chunk)
    service.stdout.on('data',chunk=>{if(String(chunk).includes('Charcoal on'))resolve()})
    service.once('exit',()=>reject(new Error(log)))
  })
  browser=await chromium.launch({channel:'chrome'})
  page=await browser.newPage({viewport:{width:1248,height:800},reducedMotion:'reduce'})
  const errors=[]
  let submissions=0
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/runs')submissions++})
  await page.goto(url)
  const editor=page.getByRole('textbox',{name:'Prompt',exact:true})
  await editor.fill('A tiny gardener under a vast branching canopy.')
  await page.locator('#setBtn').click()
  await page.getByRole('radio',{name:'B&W thumbnails',exact:true}).click()
  await page.getByRole('radiogroup',{name:'Variations',exact:true}).getByRole('radio',{name:'3',exact:true}).click()
  await page.keyboard.press('Escape')
  let releaseSave, releasePlan, saveReached, planReached
  const saveGate=new Promise(resolve=>{releaseSave=resolve})
  const planGate=new Promise(resolve=>{releasePlan=resolve})
  const saving=new Promise(resolve=>{saveReached=resolve})
  const planning=new Promise(resolve=>{planReached=resolve})
  const planIds=[]
  await page.route('**/api/workspace?*',async route=>{
    if(route.request().postDataJSON()?.pendingSubmission){saveReached();await saveGate}
    await route.continue()
  })
  await page.route('**/api/composition-plans?*',async route=>{
    planIds.push(route.request().postDataJSON().id)
    planReached()
    await planGate
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture planner unavailable.'})})
  },{times:1})
  const started=Date.now()
  await page.locator('#send').click()
  await page.locator('#send[data-sent="true"]').waitFor({timeout:500})
  await page.locator('.board-job-pending').nth(2).waitFor({timeout:500})
  assert.ok(Date.now()-started<1000,'acknowledgement does not wait for the backend')
  assert.equal(await editor.innerText(),'A tiny gardener under a vast branching canopy.')
  await saving
  assert.equal(submissions,0,'placeholders appear before the workspace save finishes')
  assert.equal(await page.getByRole('status',{name:'Generating images'}).isVisible(),true)
  await editor.press('Enter')
  await editor.press('Enter')
  const ids=await page.locator('[data-board-job]').evaluateAll(nodes=>nodes.map(node=>node.dataset.boardJob))
  releaseSave()
  await planning
  // Polling empty server runs must not erase local placeholders.
  await page.waitForTimeout(850)
  assert.deepEqual(await page.locator('[data-board-job]').evaluateAll(nodes=>nodes.map(node=>node.dataset.boardJob)),ids)
  assert.equal(submissions,0)
  await page.getByRole('button',{name:'Workspace, Board 1',exact:true}).click()
  await page.getByRole('button',{name:'New board',exact:true}).click()
  await page.getByLabel('Board name',{exact:true}).fill('Other board')
  await page.getByRole('button',{name:'Create board',exact:true}).click()
  await page.getByRole('button',{name:'Workspace, Other board',exact:true}).click()
  assert.equal(await page.locator('[data-board-job]').count(),0,'placeholders belong to their original board')
  await page.getByRole('button',{name:'Board 1',exact:true}).click()
  await page.getByRole('button',{name:'Workspace, Board 1',exact:true}).waitFor()
  assert.equal(await page.locator('.board-job-pending').count(),3,'returning to the board preserves its pending batch')
  assert.equal(await page.locator('#send').isDisabled(),true,'same request stays locked after switching boards')
  releasePlan()
  await until(async()=>await page.locator('.board-job-pending').count()===0)
  await page.locator('[data-board-job]').first().getByRole('button').first().click()
  const error=page.getByRole('alert').filter({hasText:'Fixture planner unavailable.'})
  await error.waitFor()
  assert.equal(await page.locator('.board-job-pending').count(),0)
  assert.equal(await page.locator('[data-board-job]').count(),3,'failed requests remain on the canvas')
  assert.equal(await editor.innerText(),'A tiny gardener under a vast branching canopy.')
  await page.route('**/api/composition-plans?*',async route=>{
    planIds.push(route.request().postDataJSON().id)
    await route.continue()
  })
  await page.locator('#send').click()
  await until(async()=>{const {runs}=await api('/runs');return runs.length===3&&runs.every(run=>run.status==='done')})
  assert.equal(submissions,3,'retry submits one batch only')
  assert.deepEqual(planIds,[ids[0],ids[0]],'retry reuses the original plan and run identities')
  assert.deepEqual((await api('/runs')).runs.map(run=>run.id),ids)
  await until(async()=>await page.locator('[data-board-job]').count()===0)
  assert.equal(await error.count(),0)
  assert.equal(await page.getByRole('status',{name:'Generating images'}).count(),0)
  assert.deepEqual(errors,[])
  console.log('Optimistic submission passed: immediate checkmark and three placeholders before saves/planning, preserved prompt, polling reconciliation, late failure, and duplicate-safe retry.')
}catch(error){
  if(page)await page.screenshot({path:'/tmp/charcoal-optimistic-submit-failure.png',fullPage:true}).catch(()=>{})
  throw error
}finally{
  await browser?.close()
  if(service&&!service.killed)service.kill('SIGTERM')
  await rm(work,{recursive:true,force:true})
}
