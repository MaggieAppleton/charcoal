import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {decodeRgba} from '../server/assets.mjs'
import {
  checkBoardArchive,checkImageRename,checkMarqueeLimit,checkNoteDraft,checkPlacementHistoryAndDrag,checkStyleLifecycle,
} from './qa-browser-checks.mjs'

const output=process.env.CHARCOAL_EVIDENCE
if (output) await mkdir(output,{recursive:true})
const work=await mkdtemp(join(tmpdir(),'charcoal-e2e-'))
const port=process.env.CHARCOAL_TEST_PORT ?? '4320'
const url=`http://127.0.0.1:${port}`
let service,browser
const get = async (path='/state') => {
  const res=await fetch(url+'/api'+path)
  assert.equal(res.ok,true)
  return res.json()
}
async function until(predicate, timeout=12000) {
  const end=Date.now()+timeout
  while (Date.now()<end) {
    const value=await predicate()
    if (value) return value
    await new Promise((r)=>setTimeout(r,80))
  }
  assert.fail('Timed out waiting for the expected state.')
}
async function start() {
  service=spawn(process.execPath,['server/index.mjs'],{stdio:['ignore','pipe','pipe'],env:{
    ...process.env,CHARCOAL_DEMO:'1',CHARCOAL_FIXTURE:'1',CHARCOAL_DATA_DIR:work,CHARCOAL_PORT:port,
  }})
  let log=''
  service.stderr.on('data',(c)=>{log+=c})
  await new Promise((resolve,reject)=>{
    service.stdout.on('data',(c)=>{if(String(c).includes('Charcoal on')) resolve()})
    service.once('exit',()=>reject(new Error(log)))
  })
}
const attachmentIds=async (page)=>page.locator('.att').evaluateAll((els)=>els.map((el)=>el.dataset.id))
async function detachAll(page) {
  for (const id of await attachmentIds(page)) {
    await page.locator(`.att[data-id="${id}"] .x`).click({force:true})
  }
}
const capture=async (page,name)=>{
  if (!output) return
  await page.mouse.move(2,2)
  await page.locator('#frame').screenshot({path:join(output,name+'.png')})
}
const tile=(page,id)=>page.locator(`.tile[data-id="${id}"] .board-tile-hit`)
const savedWorkspace=async (predicate)=>until(async()=>{
  const {workspace}=await get()
  return workspace&&predicate(workspace)&&workspace
})
async function run(page,prompt,count,refreshDuring=false) {
  await page.getByRole('textbox',{name:'Prompt',exact:true}).fill(prompt)
  const [response]=await Promise.all([
    page.waitForResponse((res)=>new URL(res.url()).pathname==='/api/runs'&&res.request().method()==='POST'),
    page.getByRole('button',{name:'Send to Sunburst'}).click(),
  ])
  assert.equal(response.status(),202,await response.text())
  const started=await response.json()
  assert.equal(started.inputs.length,count)
  if (refreshDuring) {
    assert.equal(started.status,'pending')
    const pending=page.getByRole('button',{name:`Pending image: ${started.label}`,exact:true})
    await pending.waitFor({state:'attached'})
    assert.equal(await pending.getAttribute('aria-busy'),'true')
    assert.equal(await pending.textContent(),'')
    assert.equal(await pending.evaluate((node)=>getComputedStyle(node).borderWidth),'0px')
    const art=pending.locator('canvas')
    await page.waitForFunction(()=>document.querySelector('.board-job-halftone')?.getContext('2d')?.getImageData(0,0,1,1).data[3]===255)
    const still=await art.evaluate((canvas)=>canvas.toDataURL())
    await page.waitForTimeout(90)
    assert.equal(await art.evaluate((canvas)=>canvas.toDataURL()),still)
    await page.reload()
  }
  return until(async()=>{
    const r=(await get('/runs')).runs.find((run)=>run.id===started.id)
    if (r?.status==='failed') assert.fail(r.error)
    return r?.status==='done'&&r.candidates.every((c)=>c.reviewStatus==='done')&&r
  })
}
const ctx = (page,id)=>page.locator(`.ctx[data-tile="${id}"]`)
async function paint(page,layer='area') {
  await page.getByRole('radio',{name:layer==='area'?'Edit area':'Sketch',exact:true}).click()
  const bounds=await page.locator('.paint-surface').boundingBox()
  await page.mouse.move(bounds.x+bounds.width*.63,bounds.y+bounds.height*.24)
  await page.mouse.down()
  await page.mouse.move(bounds.x+bounds.width*.87,bounds.y+bounds.height*.37,{steps:14})
  await page.mouse.up()
}
async function placedView(page,id) {
  const {workspace}=await get()
  const {runs:records}=await get('/runs')
  const r=records.find((r)=>r.candidates.some((c)=>c.id===id))
  await savedWorkspace(()=>true)
  const res=await page.request.put(url+'/api/workspace',{data:{...workspace,camera:{x:90-(r?.rect.x??0),y:90-(r?.rect.y??0),zoom:1}}})
  assert.equal(res.ok(),true)
  await page.reload()
  await tile(page,id).waitFor()
}

try {
  await start()
  browser=await chromium.launch({channel:process.env.CHARCOAL_BROWSER || 'chrome'})
  const page=await browser.newPage({viewport:{width:1248,height:720},reducedMotion:'reduce',acceptDownloads:true})
  const issues=[]
  page.on('pageerror',(e)=>issues.push(e.message))
  await page.goto(url)
  await tile(page,'s1').waitFor()
  const tools=page.getByRole('toolbar',{name:'Canvas tools',exact:true})
  for (const label of ['Select','Pan','Pen','Eraser','Arrow','Rectangle','Ellipse']) {
    assert.equal(await tools.getByRole('button',{name:label,exact:true}).isVisible(),true)
  }
  await tools.getByRole('button',{name:'Pen',exact:true}).click()
  assert.equal(await page.locator('.board-canvas').getAttribute('data-tool'),'pen')
  await tools.getByRole('button',{name:'Select',exact:true}).click()
  await capture(page,'app-desktop-board')
  await page.setViewportSize({width:390,height:720})
  assert.equal(await tools.getByRole('button',{name:'Ellipse',exact:true}).isVisible(),true)
  await capture(page,'app-narrow-board')
  await page.setViewportSize({width:1248,height:720})

  await checkMarqueeLimit(page,{savedWorkspace,attachmentIds,tile,detachAll})

  for (const id of ['layout','walkers','leaves']) await tile(page,id).click()
  await page.locator('#prompt').fill('A researcher crosses a shallow stream with a notebook. Use the layout from 1, the walkers from 2 and the leaf shapes from 3.')
  await capture(page,'app-desktop-attached')
  await page.locator('#setBtn').click()
  await page.getByRole('radio',{name:'4',exact:true}).waitFor()
  await capture(page,'app-desktop-settings')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#setPop').count(),0)
  await page.getByRole('button',{name:'Full prompt',exact:true}).click()
  await capture(page,'app-desktop-prompt')
  assert.match(await page.locator('#fullPrompt').innerText(),/Image 1 is Layout sketch/)
  await page.getByRole('button',{name:'Full prompt',exact:true}).click()
  await page.locator('#styleBtn').click()
  await page.getByRole('button',{name:'Quiet background',exact:true}).click()
  await capture(page,'app-desktop-style')
  await page.getByRole('button',{name:'Like this: Stream crossing 2'}).click()
  await page.getByRole('radiogroup',{name:'Example type'}).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#stylePop').count(),1)
  await page.keyboard.press('Escape')

  const narrow=await browser.newPage({viewport:{width:390,height:720},reducedMotion:'reduce'})
  narrow.on('pageerror',(e)=>issues.push(e.message))
  await savedWorkspace((w)=>w.attachments.length===3)
  await narrow.goto(url)
  await narrow.locator('.att').first().waitFor()
  await capture(narrow,'app-narrow-attached')
  await narrow.locator('#setBtn').click()
  await capture(narrow,'app-narrow-settings')
  await narrow.keyboard.press('Escape')
  await narrow.getByRole('button',{name:'Full prompt',exact:true}).click()
  await capture(narrow,'app-narrow-prompt')
  await narrow.getByRole('button',{name:'Full prompt',exact:true}).click()
  await narrow.locator('#styleBtn').click()
  await narrow.getByRole('button',{name:'Quiet background',exact:true}).click()
  await capture(narrow,'app-narrow-style')
  assert.equal(await narrow.evaluate(()=>document.documentElement.scrollWidth),390)
  await narrow.close()

  // Reorder by keyboard, then run with all references.
  await page.getByRole('button',{name:'Find Layout sketch'}).focus()
  await page.keyboard.press('Alt+ArrowRight')
  const order=await attachmentIds(page)
  assert.deepEqual(order,['walkers','layout','leaves'])
  await page.locator('#setBtn').click()
  await page.getByRole('radio',{name:'1',exact:true}).click()
  await page.keyboard.press('Escape')
  const multi=await run(page,'Draw a study from the three attached illustrations.',3)
  assert.deepEqual(multi.inputs,order)
  for (const id of await attachmentIds(page)) await page.locator(`.att[data-id="${id}"] .x`).click({force:true})
  await page.locator('#styleBtn').click()
  await page.getByRole('button',{name:'Quiet background',exact:true}).click()
  await page.getByRole('textbox',{name:'Adds to the prompt'}).fill('Keep foliage to three clear, open shapes.')
  await page.getByRole('button',{name:'Save as version 4',exact:true}).click()
  await page.getByRole('button',{name:'Version history'}).click()
  await page.getByRole('button',{name:/Version 3/}).waitFor()
  await page.keyboard.press('Escape')
  const text=await run(page,'Draw only a paper hill with a path.',0,true)
  assert.equal(text.candidates.length,1)
  assert.equal(text.style.version,4)
  assert.match(text.effectivePrompt,/three clear, open shapes/)
  assert.equal(multi.style.version,3)
  assert.match(multi.effectivePrompt,/few broad silhouettes/)

  await tile(page,'s1').click()
  await ctx(page,'s1').getByRole('button',{name:'Edit area'}).click()
  await page.getByRole('button',{name:'Hide overlay'}).click()
  await paint(page)
  await page.getByRole('button',{name:'Hide overlay'}).waitFor()
  await page.locator('#prompt').fill('Replace the fine branches with two broad leaf shapes.')
  await capture(page,'app-desktop-edit')
  await page.setViewportSize({width:390,height:720})
  await capture(page,'app-narrow-edit')
  await page.setViewportSize({width:1248,height:720})
  await page.getByRole('button',{name:'Done',exact:true}).click()
  const mask=await run(page,'Replace the fine branches with two broad leaf shapes.',1)
  assert.equal(mask.guideMode,'mask')
  assert.equal(mask.candidates[0].checks.find((c)=>c.id==='pixel')?.status,'pass')
  const raw=await fetch(url+'/api/assets/'+mask.candidates[0].rawId+'/original')
  assert.equal(raw.ok,true)
  const original=await decodeRgba(await readFile('public/samples/s1.png'))
  const edited=await decodeRgba(Buffer.from(await (await fetch(url+'/api/assets/'+mask.candidates[0].id)).arrayBuffer()))
  const bundleRecord=await get('/project')
  const savedGuide=bundleRecord.runs.find((r)=>r.id===mask.id).guidePng
  const stencil=await decodeRgba(Buffer.from(savedGuide,'base64'))
  assert.deepEqual([edited.width,edited.height],[original.width,original.height])
  let outside=0, changed=0
  for(let i=0;i<edited.data.length;i+=4) {
    if(!stencil.data[i+3]){assert.equal(edited.data.readUInt32LE(i),original.data.readUInt32LE(i));outside++}
    else if(edited.data.readUInt32LE(i)!==original.data.readUInt32LE(i)) changed++
  }
  assert.ok(changed>0)
  console.log(`Protected mask verified pixel by pixel (${outside} unchanged outside; ${changed} changed inside)`)

  const id=mask.candidates[0].id
  await placedView(page,id)
  await tile(page,id).click()
  await ctx(page,id).getByRole('button',{name:/to look at/}).click()
  await page.getByRole('radio',{name:'Result',exact:true}).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio',{name:'Source',exact:true}).getAttribute('aria-checked'),'true')
  assert.equal(await page.locator('.stage-art').getAttribute('alt'),'Stream crossing 1')
  await page.getByRole('radio',{name:'Result',exact:true}).click()
  await capture(page,'app-desktop-review')
  await page.setViewportSize({width:680,height:720})
  await capture(page,'app-medium-review')
  const rail=await page.getByRole('complementary',{name:'Review',exact:true}).boundingBox()
  assert.ok(rail.x>=0 && rail.x+rail.width<=680)
  await page.setViewportSize({width:390,height:720})
  await capture(page,'app-narrow-review')
  await page.setViewportSize({width:1248,height:720})
  await page.getByRole('button',{name:/Focal contrast/}).click()
  await capture(page,'app-desktop-evidence')
  await page.getByRole('button',{name:"It's fine"}).click()
  await page.getByRole('textbox',{name:'Why it works'}).fill('The notebook remains legible in context.')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  await page.getByRole('button',{name:'Keep',exact:true}).click()
  const imageDownload=page.waitForEvent('download')
  await page.getByRole('link',{name:'Export image'}).click()
  assert.equal(await (await imageDownload).failure(),null)
  await page.getByRole('button',{name:'Revise',exact:true}).last().click()
  assert.equal((await savedWorkspace((w)=>w.target===id)).guides[id].length,mask.guide.length)

  await page.getByRole('button',{name:/Open edit area on/}).click()
  await paint(page,'sketch')
  await page.getByRole('button',{name:'Done',exact:true}).click()
  const markup=await run(page,'Follow the sketch line to bend the branch.',1)
  assert.equal(markup.guideMode,'markup')
  assert.equal(markup.candidates[0].checks.some((c)=>c.id==='pixel'),false)

  await page.getByRole('button',{name:/^Workspace, /}).click()
  const exportWait=page.waitForEvent('download')
  await page.getByRole('button',{name:'Export project',exact:true}).click()
  const bundle=await exportWait
  const project=join(work,'reopen.json')
  await bundle.saveAs(project)
  await page.locator('input[aria-label="Import images"]').setInputFiles(['public/samples/h1.png','public/samples/h2.png'])
  const imported=await savedWorkspace((w)=>w.imageIds.length===14)
  await page.reload()
  const importedTile=tile(page,imported.imageIds.at(-1))
  await importedTile.waitFor()
  const before=(await get()).workspace.camera
  await page.mouse.move(400,310)
  await page.mouse.wheel(37,54)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0,-120)
  await page.keyboard.up('Control')
  const moved=await savedWorkspace((w)=>w.camera.zoom!==before.zoom)
  await page.reload()
  assert.deepEqual((await get()).workspace.camera,moved.camera)
  await page.getByRole('button',{name:/^Workspace, /}).click()
  await page.getByRole('button',{name:'Runs',exact:true}).click()
  await page.getByRole('dialog',{name:'Runs',exact:true}).waitFor()
  await page.keyboard.press('Escape')
  const openProject=page.locator('input[aria-label="Open project"]')
  const replaceBoard=page.getByRole('dialog',{name:'Replace board?'})
  await page.locator('#prompt').fill('Keep this draft when I cancel')
  await openProject.setInputFiles(project)
  await replaceBoard.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await page.locator('#prompt').inputValue(),'Keep this draft when I cancel')
  assert.equal(await importedTile.count(),1)
  await openProject.setInputFiles(project)
  await replaceBoard.getByRole('button',{name:'Replace board',exact:true}).click()
  await savedWorkspace((w)=>w.imageIds.length===12)
  await page.reload()
  assert.equal((await get()).runs.length,4)

  // Restore the shape of an exported in-flight request and verify the explicit retry control.
  const interrupted=JSON.parse(await readFile(project,'utf8'))
  const interruptedId=crypto.randomUUID()
  const interruptedRun={...interrupted.runs.find((r)=>r.id===text.id),
    id:interruptedId,label:'Interrupted example',status:'pending',provider:'live',dispatched:true,
    rawIds:[],candidates:[],createdAt:new Date().toISOString()}
  interrupted.runs.push(interruptedRun)
  await openProject.setInputFiles({
    name:'interrupted.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(interrupted)),
  })
  await replaceBoard.getByRole('button',{name:'Replace board',exact:true}).click()
  await until(async()=>(await get('/runs')).runs.find((r)=>r.id===interruptedId)?.status==='uncertain')
  await page.getByRole('button',{name:/^Workspace, /}).click()
  await page.getByRole('button',{name:'Runs',exact:true}).click()
  await page.getByRole('dialog',{name:'Runs',exact:true}).getByRole('button',{name:/Interrupted example/}).click()
  const retry=page.getByRole('button',{name:'Retry generation',exact:true})
  assert.equal(await retry.isDisabled(),true)
  await page.getByRole('checkbox',{name:/possible additional charge/}).check()
  await retry.click()
  const retryResult=await until(async()=>{
    const match=(await get('/runs')).runs.find((r)=>r.retriedFrom===interruptedId)
    return match?.status==='done'&&match
  })
  assert.equal(retryResult.candidates.length,1)
  await page.getByRole('button',{name:'Close run record'}).click()
  const oldCard=page.locator('.board-job').filter({hasText:'Interrupted example'})
  assert.equal(await oldCard.count(),0)
  // Canvas deletion uses the same undo history as other board edits.
  await page.setViewportSize({width:390,height:720})
  const canvas=page.getByRole('region',{name:'Canvas',exact:true})
  await canvas.press('0')
  await page.waitForFunction(()=>document.querySelector('[data-board-image=walkers]')?.getBoundingClientRect().width>160)
  await detachAll(page)
  const layout=tile(page,'layout')
  await layout.press('Delete')
  assert.equal(await layout.count(),1)
  await layout.click()
  const neighbor=await tile(page,'walkers').boundingBox()
  await page.keyboard.press('Delete')
  await layout.waitFor({state:'detached'})
  assert.ok(!(await attachmentIds(page)).includes('layout'))
  assert.deepEqual(await tile(page,'walkers').boundingBox(),neighbor)
  await canvas.press('Meta+z')
  await layout.waitFor()
  assert.ok((await attachmentIds(page)).includes('layout'))
  await page.locator('#prompt').fill('ab')
  await page.locator('#prompt').press('Backspace')
  assert.equal(await page.locator('#prompt').inputValue(),'a')
  await layout.press('Backspace')
  await savedWorkspace((w)=>w.prompt==='a' && w.deletedImageIds?.includes('layout'))
  await page.reload()
  assert.equal(await layout.count(),0)

  await page.setViewportSize({width:1248,height:720})
  await tile(page,'s1').press('Enter')
  await tile(page,'s1').press('Delete')
  await savedWorkspace((w)=>w.deletedImageIds?.includes('s1'))
  await placedView(page,id)
  const generated=tile(page,id)
  if (await generated.getAttribute('aria-pressed')!=='true') await generated.click()
  assert.equal(await generated.getAttribute('aria-pressed'),'true')
  await generated.press('Delete')
  await tile(page,id).waitFor({state:'detached'})
  await savedWorkspace((w)=>w.deletedImageIds?.includes(id))
  assert.ok((await get('/runs')).runs.some((r)=>r.id===mask.id && r.target==='s1' && r.candidates.some((c)=>c.id===id)))
  assert.equal((await page.request.get(url+'/api/assets/s1')).ok(),true)
  await page.reload()
  assert.equal(await tile(page,id).count(),0)
  console.log('Canvas deletion passed: pointer selection, Delete and Backspace, undo, reload, and retained run sources.')

  // Upload, attach and place references as distinct board actions.
  const referenceButton=page.getByRole('button',{name:'References',exact:true})
  await referenceButton.click()
  const library=page.getByRole('dialog',{name:'References',exact:true})
  await library.getByLabel('Upload reference images').setInputFiles(['public/samples/layout.png','public/samples/walkers.png'])
  const references=(await savedWorkspace((w)=>w.referenceIds?.length===2)).referenceIds
  assert.equal(await tile(page,references[0]).count(),0)
  await library.getByRole('button',{name:/^Attach .* to prompt$/}).first().click()
  assert.ok((await attachmentIds(page)).includes(references[0]))
  assert.equal(await tile(page,references[0]).count(),0)
  await library.getByRole('button',{name:/^Place .* on canvas$/}).first().click()
  await tile(page,references[0]).waitFor()
  await savedWorkspace((w)=>w.imageIds.includes(references[0]))
  await checkPlacementHistoryAndDrag(page,{referenceButton,library,references,tile,savedWorkspace,attachmentIds})
  await page.reload()
  await referenceButton.click()
  assert.equal(await library.locator('.reference-row').count(),2)
  assert.equal(await tile(page,references[1]).count(),0)
  await page.keyboard.press('Escape')
  assert.equal(await library.count(),0)
  assert.ok(await referenceButton.evaluate((el)=>el===document.activeElement))
  console.log('References passed: batch upload off canvas, attach without placing, explicit placement, and reload.')

  await checkImageRename(page,{referenceButton,library,references,tile,ctx,detachAll})


  await detachAll(page)
  await referenceButton.click()
  await library.getByRole('button',{name:/^Attach .* to prompt$/}).last().click()
  await page.keyboard.press('Escape')
  await canvas.press('0')
  const first=tile(page,'h2'), second=tile(page,'h3')
  await first.click()
  await second.click({modifiers:['Shift']})
  const selectedGroup=await attachmentIds(page)
  assert.deepEqual(selectedGroup,[references[1],'h2','h3'])
  await page.keyboard.press('Delete')
  await first.waitFor({state:'detached',timeout:3000})
  await second.waitFor({state:'detached',timeout:3000})
  assert.deepEqual(await attachmentIds(page),[references[1]])
  await page.keyboard.press('Meta+z')
  await first.waitFor()
  await second.waitFor()
  assert.deepEqual(await attachmentIds(page),selectedGroup)
  await page.keyboard.press('Meta+Shift+z')
  await first.waitFor({state:'detached',timeout:3000})
  await second.waitFor({state:'detached',timeout:3000})
  assert.deepEqual(await attachmentIds(page),[references[1]])
  await page.keyboard.press('Meta+z')
  await first.waitFor()
  await second.waitFor()
  assert.deepEqual(await attachmentIds(page),selectedGroup)

  // The box selects just these tiles, even when a different tile is attached.
  await tile(page,'walkers').click()
  const a=await first.boundingBox(), b=await second.boundingBox()
  await page.mouse.move(a.x-4,a.y-5)
  await page.mouse.down()
  await page.mouse.move(b.x+b.width+4,b.y+b.height+5,{steps:6})
  await page.mouse.up()
  await page.keyboard.press('Backspace')
  await first.waitFor({state:'detached',timeout:3000})
  await second.waitFor({state:'detached',timeout:3000})
  assert.deepEqual(await attachmentIds(page),[references[1],'walkers'])
  await savedWorkspace((w)=>w.deletedImageIds?.includes('h2') && w.deletedImageIds.includes('h3') && w.attachments.includes('walkers'))
  await page.reload()
  await tile(page,'walkers').waitFor()
  assert.equal(await first.count()+await second.count(),0)
  console.log('Group deletion passed: Shift-click, one-step undo, and box selection with unrelated attachments.')

  await canvas.press('0')
  await tools.getByRole('button',{name:'Pen',exact:true}).click()
  for (const [x,y] of [[480,350],[480,405],[725,405]]) {
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.mouse.move(x+55,y+20,{steps:6})
    await page.mouse.up()
  }
  const drawn=(await savedWorkspace((w)=>w.annotations.length===3)).annotations
  await tools.getByRole('button',{name:'Select',exact:true}).click()
  await page.mouse.move(445,318)
  await page.mouse.down()
  await page.mouse.move(575,460,{steps:6})
  await page.mouse.up()
  const selectedMarks=page.locator('.board-mark-selected')
  assert.equal(await selectedMarks.count(),2)
  await page.keyboard.press('Delete')
  await selectedMarks.first().waitFor({state:'detached',timeout:3000})
  const remaining=(await savedWorkspace((w)=>w.annotations.length===1)).annotations
  assert.deepEqual(remaining,[drawn[2]])
  await page.keyboard.press('Meta+z')
  assert.deepEqual((await savedWorkspace((w)=>w.annotations.length===3)).annotations,drawn)
  await page.mouse.click(725,405)
  assert.equal(await selectedMarks.count(),1)
  await page.keyboard.press('Backspace')
  assert.deepEqual((await savedWorkspace((w)=>w.annotations.length===2)).annotations,drawn.slice(0,2))
  console.log('Sketch deletion passed: click and marquee selection, Delete and Backspace, and undo.')

  await checkNoteDraft(page,tools)


  // Switching boards restores the board's own references, styles, images and draft.
  const catalogButton=page.getByRole('button',{name:/^Workspace, /})
  await catalogButton.click()
  const firstBoard=await page.getByRole('group',{name:'Boards'}).locator('[aria-current=true]').innerText()
  await page.getByRole('button',{name:'New board',exact:true}).click()
  await page.getByRole('textbox',{name:'Board name'}).fill('Second illustration')
  await page.getByRole('button',{name:'Create board',exact:true}).click()
  await page.getByRole('button',{name:'Import images',exact:true}).waitFor()
  assert.equal(await page.locator('#styleName').innerText(),'No style')
  await referenceButton.click()
  assert.equal(await library.locator('.reference-row').count(),0)
  await page.keyboard.press('Escape')
  await page.locator('#prompt').fill('Second board draft')
  await catalogButton.click()
  await page.getByRole('button',{name:firstBoard.trim(),exact:true}).click()
  await tile(page,references[0]).waitFor()
  assert.equal(await page.locator('#styleName').innerText(),'Field notes')
  await referenceButton.click()
  assert.equal(await library.locator('.reference-row').count(),2)
  await page.keyboard.press('Escape')
  await catalogButton.click()
  await page.getByRole('button',{name:'Second illustration',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='Second board draft')
  await page.reload()
  await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='Second board draft')
  assert.equal(await tile(page,references[0]).count(),0)
  await checkBoardArchive(page,{catalogButton,firstBoard,references,tile})
  console.log('Board switching passed: independent drafts, rules, canvas, and references through reload.')

  await checkStyleLifecycle(page)
  assert.deepEqual(issues,[])
  console.log('Browser fixture passed: batch import, pan/zoom persistence, style snapshots, text and reference runs, mask, markup, review, revision, exports and interrupted-run retry.')
} finally {
  await browser?.close()
  if (service && service.exitCode===null) {
    const stopped=new Promise((resolve)=>service.once('exit',resolve))
    service.kill()
    await stopped
  }
  await rm(work,{recursive:true,force:true})
}
