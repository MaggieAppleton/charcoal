import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'

const work=await mkdtemp(join(tmpdir(),'charcoal-metaphors-'))
const port=process.env.CHARCOAL_TEST_PORT??'4371'
const url=`http://127.0.0.1:${port}`
let service,browser,page
const api=async(path='/state',options)=>{
  const response=await fetch(url+'/api'+path,options)
  assert.equal(response.ok,true,await response.clone().text())
  return response.json()
}
const until=async predicate=>{
  const start=Date.now()
  while(Date.now()-start<20000){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,80))}
  assert.fail('Timed out waiting for metaphor state')
}
const saved=predicate=>until(async()=>{const {workspace}=await api();return workspace&&predicate(workspace)&&workspace})
const json=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
try {
  service=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,
    CHARCOAL_PORT:port,CHARCOAL_DEMO:'1',CHARCOAL_FIXTURE:'1',CHARCOAL_DATA_DIR:work},stdio:['ignore','pipe','pipe']})
  await new Promise((resolve,reject)=>{
    let log='';service.stderr.on('data',chunk=>log+=chunk)
    service.stdout.on('data',chunk=>{if(String(chunk).includes('Charcoal on'))resolve()})
    service.once('exit',()=>reject(new Error(log)))
  })
  browser=await chromium.launch({channel:'chrome'})
  page=await browser.newPage({viewport:{width:1248,height:900},reducedMotion:'reduce',acceptDownloads:true})
  page.setDefaultTimeout(8000)
  const errors=[]
  page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message)})
  page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).pathname.startsWith('/assets/'))console.error('Asset response:',response.status(),response.url())})
  await page.goto(url)
  const canvas=page.getByRole('region',{name:'Canvas',exact:true})
  const screenshot=async name=>{await mkdir('test-results',{recursive:true});await page.screenshot({path:`test-results/${name}.png`})}
  const card=id=>page.locator(`[data-metaphor-id="${id}"]`)
  const optionMarks=w=>w.annotations.filter(mark=>mark.metaphor?.kind==='option')
  const context='A community opens a repair café so its neighbours can share tools and fix things together.'
  const illustration='Ink illustrations of a repair café.'
  const briefField=page.getByRole('textbox',{name:'Brief context',exact:true})
  const feedbackField=page.getByRole('textbox',{name:'Metaphor feedback',exact:true})
  const promptField=page.getByRole('textbox',{name:'Prompt',exact:true})
  const btn=name=>page.getByRole('button',{name,exact:true})
  const mode=async name=>{
    await page.getByRole('button',{name:/^Composer mode,/}).click()
    await page.getByRole('dialog',{name:'Composer mode'}).getByRole('button',{name,exact:true}).click()
  }
  const select=id=>card(id).getByRole('button').click()
  const getMark=(workspace,id)=>workspace.annotations.find(mark=>mark.id===id)
  const wire=id=>page.locator(`[data-metaphor-wire="${id}"]`)
  const initial=await saved(()=>true)
  const legacy=[
    {id:'legacy-brief',kind:'note',points:[{x:70,y:523}],text:'A public library',metaphor:{kind:'brief',title:'Public library',context:'A public library'}},
    {id:'legacy-option',kind:'note',points:[{x:280,y:494}],text:'Shared key',metaphor:{kind:'option',briefId:'legacy-brief',
      title:'The shared key',context:'A public library',scene:'A shared key',meaning:'Public access',caveat:'',promptId:'legacy-prompt'}},
    {id:'legacy-prompt',kind:'note',promptBlock:true,points:[{x:566,y:494}],text:'Editable legacy scene'},
  ]
  await api('/workspace',{...json({...initial,annotations:legacy}),method:'PUT'})
  await page.reload()
  await card('legacy-option').waitFor()
  const legacyBounds=await card('legacy-option').boundingBox()
  await select('legacy-option')
  assert.deepEqual(await card('legacy-option').boundingBox(),legacyBounds,'selection retains world and screen bounds')
  assert.equal(await page.getByRole('textbox',{name:'Metaphor scene'}).inputValue(),'A shared key')
  assert.equal(await wire('legacy-option').count(),1)
  await btn('View prompt').click()
  assert.equal((await api()).workspace.annotations.filter(mark=>mark.promptBlock).length,1,'legacy prompt is reused')
  await btn('Open source brief').click()
  assert.equal(await briefField.inputValue(),'A public library')
  assert.equal(await btn('Clear brief draft').count(),0,'saved brief is a canvas card')
  await select('legacy-option')
  await feedbackField.fill('Make the key quieter.')
  await btn('Clear feedback').click()
  assert.equal(await feedbackField.inputValue(),'')
  const legacyAfterClear=await saved(w=>getMark(w,'legacy-option')?.metaphor?.feedback==='')
  assert.equal(getMark(legacyAfterClear,'legacy-option').metaphor.scene,'A shared key')
  assert.equal(getMark(legacyAfterClear,'legacy-brief').text,'A public library')
  await btn('Return to brief draft').click()
  assert.equal(await briefField.inputValue(),'')
  assert.equal(await btn('Explore metaphors').isDisabled(),true)
  assert.equal(await btn('Add brief').count(),0)

  await mode('Illustration')
  await canvas.press('0')
  await promptField.fill(illustration)
  const ref=page.locator('[data-board-image]').first()
  const refName=await ref.getAttribute('data-board-image')
  // Set a real reference directly in the saved fixture to exercise the loaded draft.
  const before=await saved(w=>w.prompt===illustration)
  await api('/workspace',{...json({...before,active:null,attachments:[refName]}),method:'PUT'})
  await page.reload()
  await page.locator('.att').first().waitFor()
  const originalPrompt=await promptField.innerText()

  await mode('Metaphor')
  await briefField.fill(context)
  await mode('Illustration')
  assert.equal(await promptField.innerText(),originalPrompt)
  assert.equal(await page.locator('.att').count(),1)
  await mode('Metaphor')
  assert.equal(await briefField.inputValue(),context)
  await btn('Import a post link').click()
  await page.getByRole('textbox',{name:'Post link',exact:true}).fill('https://example.com/article')
  await btn('Clear brief draft').click()
  assert.equal(await briefField.inputValue(),'')
  assert.equal(await page.getByRole('textbox',{name:'Post link',exact:true}).count(),0)
  await saved(w=>w.metaphorDraft?.context===''&&w.prompt===illustration&&w.attachments.includes(refName))
  await briefField.fill(context)
  const artwork=await page.locator('[data-board-image]').evaluateAll(tiles=>tiles.map(tile=>{
    const {x,y,width,height}=tile.getBoundingClientRect()
    return {x,y,width,height}
  }))

  let calls=0
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/metaphors')calls++})
  let release
  const held=new Promise(resolve=>release=resolve)
  await page.route('**/api/metaphors?*',async route=>{await held;await route.continue()},{times:1})
  await btn('Explore metaphors').evaluate(button=>{button.click();button.click()})
  await page.getByRole('status',{name:'Exploring metaphors'}).waitFor()
  assert.equal(await briefField.inputValue(),context)
  await until(()=>calls===1)
  await mode('Illustration')
  assert.equal(await promptField.innerText(),originalPrompt)
  await mode('Metaphor')
  await page.getByRole('status',{name:'Exploring metaphors'}).waitFor()
  // Open a different option and move the camera while the fixture is pending.
  await select('legacy-option')
  await canvas.press('-')
  await feedbackField.focus()
  const camera=(await saved(w=>w.camera.zoom===.8)).camera
  release()
  const explored=await saved(w=>optionMarks(w).length===4)
  assert.equal(calls,1,'duplicate activation sends one request')
  assert.deepEqual(explored.camera,camera,'background completion leaves the camera alone')
  assert.equal(await feedbackField.evaluate(field=>field===document.activeElement),true,'background completion leaves focus alone')
  assert.equal(await page.getByRole('textbox',{name:'Metaphor title'}).inputValue(),'The shared key')
  const briefId=explored.metaphorDraft.briefId
  const options=optionMarks(explored).filter(mark=>mark.metaphor.briefId===briefId)
  assert.equal(new Set(options.map(mark=>mark.metaphor.scene)).size,3)
  assert.ok(options.every(mark=>mark.metaphor.context===context))
  assert.deepEqual(explored.annotations.filter(mark=>mark.id.startsWith('legacy-')),legacyAfterClear.annotations)
  assert.equal((await api('/runs')).runs.length,0,'exploration creates zero image runs')

  const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height
  const placed=[getMark(explored,briefId),...options]
  const bounds=placed.map(mark=>({...mark.points[0],...(mark.metaphor.kind==='brief'?{width:144,height:36}:{width:224,height:96})}))
  assert.ok(bounds.every((rect,index)=>[...artwork,...bounds.slice(0,index),{x:280,y:494,width:224,height:96}]
    .every(other=>!overlap(rect,other))),'sources and options avoid existing art, cards, and siblings')
  await btn('Return to brief draft').click()
  assert.equal(await briefField.inputValue(),context)
  await btn('View options').click()
  await screenshot('metaphors-canvas-options')

  const first=options[0],second=options[1]
  const beforeSelection=await card(first.id).boundingBox()
  await select(first.id)
  assert.deepEqual(await card(first.id).boundingBox(),beforeSelection)
  await screenshot('metaphors-refinement')
  const drag=async(id,dx,dy)=>{
    const old=await api()
    const original=getMark(old.workspace,id).points[0]
    const zoom=old.workspace.camera.zoom
    const path=await wire(id).getAttribute('d')
    const box=await card(id).boundingBox()
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
    await page.mouse.down()
    await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:8})
    await until(async()=>await wire(id).getAttribute('d')!==path)
    assert.deepEqual(getMark((await api()).workspace,id).points[0],original,'drag preview does not save')
    await page.mouse.up()
    const moved=await saved(w=>getMark(w,id).points[0].x!==original.x)
    const point=getMark(moved,id).points[0]
    assert.ok(Math.abs(point.x-original.x-dx/zoom)<.02)
    assert.ok(Math.abs(point.y-original.y-dy/zoom)<.02)
    assert.notEqual(await wire(id).getAttribute('d'),path)
    const endpoint=(await wire(id).getAttribute('d')).match(/[-.\d]+/g).map(Number).slice(-2)
    const x=endpoint[0]-point.x,y=endpoint[1]-point.y
    assert.ok((x===0||x===224)&&y===48 || (y===0||y===96)&&x===112,'wire ends at the moved card edge')
    return point
  }
  const movedFirst=await drag(first.id,36,14)
  const previousZoom=(await api()).workspace.camera.zoom
  await canvas.press('-')
  await saved(w=>Math.abs(w.camera.zoom-previousZoom/1.25)<.001)
  const movedSecond=await drag(second.id,22,-17)
  await page.reload()
  await card(first.id).waitFor()
  const reloaded=(await api()).workspace
  assert.deepEqual(getMark(reloaded,first.id).points[0],movedFirst)
  assert.deepEqual(getMark(reloaded,second.id).points[0],movedSecond)

  await select(first.id)
  const original=structuredClone(first.metaphor)
  const feedback='Use a single shared workbench as the focal point.'
  await feedbackField.fill(feedback)
  await page.route('**/api/metaphors?*',async route=>{
    const response=await route.fetch()
    assert.equal(response.ok(),true)
    await route.fulfill({status:503,json:{error:'Fixture response was lost.'}})
  },{times:1})
  await btn('Refine').click()
  await page.getByRole('alert').filter({hasText:'Fixture response was lost.'}).waitFor()
  assert.equal(await feedbackField.inputValue(),feedback)
  assert.equal(await page.getByRole('textbox',{name:'Metaphor scene'}).inputValue(),original.scene)
  await btn('Recover request').click()
  const refined=await saved(w=>getMark(w,first.id)?.metaphor.history?.length===1)
  const refinedData=getMark(refined,first.id).metaphor
  assert.match(refinedData.scene,/shared workbench/)
  assert.equal(refinedData.history[0].scene,original.scene)
  assert.equal(refinedData.context,context)
  assert.equal(refinedData.feedback,feedback)
  assert.equal(await btn('Refine').isDisabled(),true)
  await btn('Use as prompt').click()
  const promoted=await saved(w=>!!getMark(w,first.id)?.metaphor.promptId)
  const promptId=getMark(promoted,first.id).metaphor.promptId
  const prompt=getMark(promoted,promptId)
  assert.equal(prompt.promptBlock,true)
  assert.equal(prompt.text,refinedData.scene)
  await canvas.press('ControlOrMeta+z')
  await saved(w=>!getMark(w,promptId))
  await canvas.press('ControlOrMeta+Shift+z')
  await saved(w=>getMark(w,promptId))
  await btn('View prompt').click()
  assert.equal((await api()).workspace.annotations.filter(mark=>mark.promptBlock).length,2)
  await mode('Illustration')
  const promptBlock=page.locator('.board-prompt-block').filter({hasText:refinedData.scene})
  await promptBlock.hover()
  await promptBlock.getByRole('button',{name:'Add to prompt',exact:true}).click()
  await saved(w=>w.promptBlockIds?.includes(promptId))
  await btn('Full prompt').click()
  assert.ok((await page.locator('#fullPrompt').innerText()).includes(refinedData.scene))
  await btn('Full prompt').click()
  await mode('Metaphor')

  await page.setViewportSize({width:390,height:720})
  const composer=await page.locator('.composer').boundingBox()
  assert.ok(composer.x>=0&&composer.x+composer.width<=390&&composer.y>=0&&composer.y+composer.height<=720)
  assert.equal(await feedbackField.inputValue(),feedback)
  await screenshot('metaphors-composer-narrow')

  await btn('Return to brief draft').click()
  await btn('Import a post link').click()
  const urlInput=page.getByRole('textbox',{name:'Post link',exact:true})
  await urlInput.fill('http://127.0.0.1/private')
  await btn('Import text').click()
  await page.getByRole('alert').filter({hasText:'public HTTP or HTTPS'}).waitFor()
  assert.equal(await briefField.inputValue(),context,'the private-link error preserves pasted context')
  assert.equal(await urlInput.inputValue(),'http://127.0.0.1/private')
  const importedArticle={url:'https://example.com/post',title:'The repair café',text:'Neighbours share a workbench and lend tools.'}
  await page.route('**/api/article?*',route=>route.fulfill({json:importedArticle}),{times:1})
  await urlInput.fill(importedArticle.url)
  await urlInput.press('Enter')
  const sourceLink=page.getByRole('link',{name:importedArticle.title})
  await sourceLink.waitFor()
  assert.equal(await sourceLink.getAttribute('href'),importedArticle.url)
  assert.equal(await briefField.inputValue(),context+'\n\n'+importedArticle.text)
  await briefField.fill(importedArticle.text+' A drawer holds spare fasteners.')
  await screenshot('metaphors-article-draft')
  const articleDraft=await saved(w=>w.metaphorDraft.context.endsWith('fasteners.'))
  assert.deepEqual(articleDraft.metaphorDraft.article,{url:importedArticle.url,title:importedArticle.title})
  await btn('Explore metaphors').click()
  const articleBoard=await saved(w=>optionMarks(w).length===7)
  const articleBrief=getMark(articleBoard,articleBoard.metaphorDraft.briefId)
  assert.equal(articleBrief.metaphor.title,importedArticle.title)
  assert.deepEqual(articleBrief.metaphor.article,articleDraft.metaphorDraft.article)
  assert.ok(optionMarks(articleBoard).filter(mark=>mark.metaphor.briefId===articleBrief.id).every(mark=>
    mark.metaphor.article.url===importedArticle.url&&mark.metaphor.context===articleDraft.metaphorDraft.context))
  await btn('View options').waitFor()

  const bundle=await api('/project')
  await api('/project',json(bundle))
  await page.reload()
  await card(first.id).waitFor()
  assert.equal(getMark((await api()).workspace,first.id).metaphor.promptId,promptId)
  await btn('Workspace, Board 1').waitFor()
  const articleId=articleBrief.id
  const group=w=>optionMarks(w).filter(mark=>mark.metaphor.briefId===articleId)
  await mode('Metaphor')
  const plus=btn('Add metaphor option')
  const complete=async count=>saved(w=>group(w).length===count&&!getMark(w,articleId).metaphor.request)
  const initialIdeas=group((await api()).workspace)
  let releaseAppend
  const appendHeld=new Promise(resolve=>releaseAppend=resolve)
  await page.route('**/api/metaphors?*',async route=>{await appendHeld;await route.continue()},{times:1})
  const beforeAppend=calls
  await until(()=>page.getByRole('button',{name:/^Composer mode,/}).evaluate(button=>button===document.activeElement))
  await plus.focus()
  await plus.evaluate(button=>{button.click();button.click()})
  await page.getByRole('status',{name:'Exploring metaphors'}).waitFor()
  await until(()=>calls===beforeAppend+1)
  const beforeRelease=(await api()).workspace
  releaseAppend()
  const appended=await complete(4)
  assert.equal(calls,beforeAppend+1)
  assert.deepEqual(group(appended).slice(0,3),initialIdeas)
  assert.equal(await plus.evaluate(button=>button===document.activeElement),true)
  assert.deepEqual(appended.camera,beforeRelease.camera)
  await plus.click()
  const five=await complete(5)
  assert.equal(new Set(group(five).map(mark=>mark.metaphor.scene)).size,5)

  // Toolbar and keyboard deletion both leave the group source and unrelated prompts intact.
  await page.setViewportSize({width:320,height:720})
  await btn('View options').click()
  const newOption=group(five).at(-1)
  await select(newOption.id)
  const trash=btn('Delete metaphor option')
  const trashBounds=await trash.boundingBox()
  assert.ok(trashBounds.x>=0&&trashBounds.x+trashBounds.width<=320)
  await trash.click()
  await complete(4)
  await until(()=>briefField.evaluate(field=>field===document.activeElement))
  await canvas.press('ControlOrMeta+z')
  assert.deepEqual(getMark(await complete(5),newOption.id),newOption)
  await btn('View options').click()
  await select(newOption.id)
  await canvas.press('Delete')
  await complete(4)
  await canvas.press('ControlOrMeta+z')
  await complete(5)
  await canvas.press('ControlOrMeta+Shift+z')
  await complete(4)
  for(const option of group(five).slice(0,-1)) {
    await btn('View options').click()
    await select(option.id)
    await trash.click()
    await saved(w=>!getMark(w,option.id))
  }
  const empty=await complete(0)
  assert.equal(Object.keys(getMark(empty,articleId).metaphor.dismissedOptions).length,5)
  assert.ok(getMark(empty,promptId))
  assert.equal(await btn('View options').count(),0)
  await plus.waitFor()
  const plusBounds=await plus.boundingBox()
  assert.ok(plusBounds.x>=0&&plusBounds.x+plusBounds.width<=320)

  // Export an actual in-flight request and replace a second board with the export.
  // The request can complete only on its originating board until explicitly restarted.
  let releaseSwitch
  const switchHeld=new Promise(resolve=>releaseSwitch=resolve)
  await page.route('**/api/metaphors?*',async route=>{await switchHeld;await route.continue()},{times:1})
  await plus.click()
  await saved(w=>getMark(w,articleId).metaphor.request)
  const pendingBundle=await api('/project')
  await btn('Workspace, Board 1').click()
  await btn('New board').click()
  await page.getByLabel('Board name',{exact:true}).fill('Imported metaphors')
  await btn('Create board').click()
  await btn('Workspace, Imported metaphors').waitFor()
  const other=(await api('/boards')).activeId
  await promptField.fill('A newer draft on another board.')
  const otherDraft=await until(async()=>{
    const {workspace}=await api(`/state?board=${other}`)
    return workspace?.prompt==='A newer draft on another board.'&&workspace
  })
  releaseSwitch()
  const fromZero=await complete(1)
  assert.equal(await promptField.innerText(),otherDraft.prompt)
  assert.equal(await card(articleId).count(),0)
  await btn('Workspace, Imported metaphors').click()
  await btn('Board 1').click()
  await btn('Workspace, Board 1').waitFor()
  await canvas.press('ControlOrMeta+z')
  await complete(0)
  await canvas.press('ControlOrMeta+Shift+z')
  assert.deepEqual(group(await complete(1)),group(fromZero))
  await btn('Workspace, Board 1').click()
  await btn('Imported metaphors').click()
  await btn('Workspace, Imported metaphors').waitFor()

  const importedBoard=await api(`/project?board=${other}`,json(pendingBundle))
  assert.equal(group(importedBoard.workspace).length,0)
  assert.deepEqual(getMark(importedBoard.workspace,articleId).metaphor.dismissedOptions,getMark(empty,articleId).metaphor.dismissedOptions)
  await page.reload()
  await mode('Metaphor')
  const importedRequests=[]
  await page.route('**/api/metaphors?*',route=>{
    importedRequests.push(route.request().postDataJSON())
    return route.continue()
  })
  await btn('Recover metaphor request').click()
  await page.getByRole('alert').filter({hasText:'No saved result'}).waitFor()
  assert.equal(importedRequests[0].cacheOnly,true)
  assert.equal(importedRequests[0].id,getMark(pendingBundle.workspace,articleId).metaphor.request.id)
  const importedEmpty=await api(`/state?board=${other}`)
  assert.equal(group(importedEmpty.workspace).length,0)
  await btn('Start new request').click()
  await until(async()=>group((await api(`/state?board=${other}`)).workspace).length===1)
  assert.equal(importedRequests[1].cacheOnly,false)
  assert.notEqual(importedRequests[1].id,importedRequests[0].id)
  assert.deepEqual(importedRequests[1].exclusions,importedRequests[0].exclusions)
  assert.equal(importedRequests[1].count,1)
  await screenshot('metaphors-iteration-narrow')

  // Exercise the actual eraser gesture while the option is being refined.
  {
    const state=await api(`/state?board=${other}`)
    const [option]=group(state.workspace)
    const originalScene=option.metaphor.scene
    await page.setViewportSize({width:1248,height:900})
    await btn('View options').click()
    await select(option.id)
    await feedbackField.fill('Remove the spare stool.')
    let finishRefinement, refinementReached
    const held=new Promise(resolve=>finishRefinement=resolve)
    const reached=new Promise(resolve=>refinementReached=resolve)
    await page.route('**/api/metaphors?*',async route=>{
      refinementReached()
      await held
      await route.continue()
    },{times:1})
    await btn('Refine').click()
    await reached
    await btn('Eraser').click()
    const bounds=await card(option.id).boundingBox()
    await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.5)
    await page.mouse.down()
    await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.5,{steps:5})
    await page.mouse.up()
    const current=()=>api(`/state?board=${other}`).then(state=>state.workspace)
    const erased=await until(async()=>{
      const w=await current()
      return !getMark(w,option.id)&&w
    })
    assert.equal(getMark(erased,articleId).metaphor.dismissedOptions[option.id].scene,originalScene)
    assert.deepEqual(getMark(erased,promptId),getMark(state.workspace,promptId))
    finishRefinement()
    await until(()=>page.getByRole('status',{name:'Exploring metaphors'}).count().then(count=>!count))
    await plus.click()
    await until(async()=>group(await current()).length===1)
    assert.ok(importedRequests.at(-1).exclusions.some(item=>item.scene===originalScene))
    assert.equal(getMark(await current(),option.id),undefined)
    await canvas.press('ControlOrMeta+z')
    await canvas.press('ControlOrMeta+z')
    const restored=await until(async()=>{
      const w=await current()
      return getMark(w,option.id)&&w
    })
    assert.match(getMark(restored,option.id).metaphor.scene,/Remove the spare stool/)
    assert.equal(getMark(restored,articleId).metaphor.dismissedOptions[option.id],undefined)
    assert.deepEqual(getMark(restored,promptId),getMark(state.workspace,promptId))
  }
  assert.deepEqual(errors,[])
  console.log('Metaphor browser passed: legacy cards and prompt links, drafts and references, duplicate and background requests, crowded placement, dragging and wire endpoints at two zooms, reload, refinement retry, prompt blocks, project round trip, narrow composer, post import, repeat append, deletion undo/redo, refill, board switch and cache-only import recovery.')
}catch(error){
  if(page){
    await page.screenshot({path:'/tmp/charcoal-metaphor-flow-failure.png',fullPage:true}).catch(()=>{})
    console.error('Visible UI:',await page.locator('body').innerText().catch(()=>''))
  }
  throw error
}finally{
  await browser?.close()
  if(service&&service.exitCode===null){const stopped=new Promise(resolve=>service.once('exit',resolve));service.kill();await stopped}
  await rm(work,{recursive:true,force:true})
}
