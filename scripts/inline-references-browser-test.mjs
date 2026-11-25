import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'

const work=await mkdtemp(join(tmpdir(),'charcoal-inline-references-'))
const url=`http://127.0.0.1:${process.env.CHARCOAL_TEST_PORT??4333}`
let service,browser,page
const api=async(path='/state',options)=>{
  const response=await fetch(url+'/api'+path,options)
  assert.equal(response.ok,true,await response.clone().text())
  return response.json()
}
async function until(predicate){
  const started=Date.now()
  while(Date.now()-started<15000){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60))}
  assert.fail('Timed out waiting for inline reference state')
}
const saved=predicate=>until(async()=>{const {workspace}=await api();return workspace&&predicate(workspace)&&workspace})
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
  page.setDefaultTimeout(8000)
  const errors=[]
  let submissions=0
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/runs')submissions++})
  await page.goto(url)
  const editor=page.getByRole('textbox',{name:'Prompt',exact:true})
  const chip=id=>editor.locator(`[data-image-id="${id}"]`)
  const insert=id=>page.getByRole('button',{name:`Insert reference to ${id}`,exact:true}).click()
  const remove=async name=>{
    await page.getByRole('button',{name:`Insert reference to ${name}`,exact:true}).hover()
    await page.getByRole('button',{name:`Remove ${name}`,exact:true}).click()
  }
  const caret=async(offset)=>editor.evaluate((element,offset)=>{
    element.focus()
    const range=document.createRange()
    if(offset===null){range.selectNodeContents(element);range.collapse(false)}
    else {range.setStart(element.firstChild,offset);range.collapse(true)}
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  },offset)

  // Previously saved role-form directions become visible prose exactly once.
  const initial=await saved(w=>w.inlineReferencesVersion===1)
  const legacy={...initial,prompt:'Keep my original brief.',attachments:['layout'],
    referenceDirections:{layout:{roles:['composition','style'],use:'Loose brushwork.',avoid:'The original colours.'}}}
  delete legacy.inlineReferencesVersion
  await api('/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(legacy)})
  await page.reload()
  const migrated=await saved(w=>w.inlineReferencesVersion===1&&w.prompt.includes('Loose brushwork.'))
  assert.ok(migrated.prompt.startsWith('Keep my original brief.'))
  assert.ok(migrated.prompt.includes('[[image:layout]]'))
  assert.ok(migrated.prompt.includes('Avoid The original colours.'))
  assert.match(await editor.innerText(),/Loose brushwork/)
  await page.reload()
  assert.equal((await saved(w=>w.inlineReferencesVersion===1)).prompt,migrated.prompt,'migration must not repeat')
  assert.equal(await page.locator('.reference-direction-trigger').count(),0,'role form is gone')
  await remove('Layout sketch')

  await editor.fill('Before after')
  await caret(7)
  await page.getByRole('button',{name:'Add Layout sketch to prompt',exact:true}).click()
  let expected='Before [[image:layout]] after'
  await saved(w=>w.prompt===expected)
  assert.equal(await chip('layout').count(),1)
  await page.keyboard.insertText('and ')
  expected='Before [[image:layout]] and after'
  await saved(w=>w.prompt===expected)
  await caret(null)
  await page.keyboard.insertText(' Then ')
  await page.getByRole('button',{name:'Add Two walkers to prompt',exact:true}).click()
  await page.keyboard.insertText('for rhythm.')
  expected+=' Then [[image:walkers]] for rhythm.'
  await saved(w=>w.prompt===expected)
  await caret(null)
  await page.keyboard.insertText(' Again ')
  await insert('Layout sketch')
  await page.keyboard.insertText('only its colours.')
  expected+=' Again [[image:layout]] only its colours.'
  await saved(w=>w.prompt===expected)
  assert.equal(await chip('layout').count(),2,'tray can insert repeated mentions')
  const trayThumb=page.getByRole('button',{name:'Insert reference to Layout sketch',exact:true})
  const thumbBounds=await trayThumb.boundingBox()
  assert.ok(thumbBounds.width>=96&&thumbBounds.height>=68,'reference thumbnails have useful preview size')
  await trayThumb.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await saved(w=>w.attachments[0]==='walkers'&&w.prompt===expected)
  assert.equal(await chip('layout').first().getAttribute('aria-label'),'Image 2: Layout sketch')
  assert.equal(await chip('walkers').getAttribute('aria-label'),'Image 1: Two walkers')
  await page.getByRole('button',{name:'Full prompt',exact:true}).click()
  assert.match(await page.locator('#fullPrompt').innerText(),/Before Image 2 and after Then Image 1 for rhythm\. Again Image 2 only its colours\./)
  await page.getByRole('button',{name:'Full prompt',exact:true}).click()
  await page.reload()
  await chip('walkers').waitFor()
  assert.equal((await api()).workspace.prompt,expected)
  assert.equal(await chip('layout').count(),2)
  await caret(null)
  await editor.press('Shift+Enter')
  await page.keyboard.insertText('Next line.')
  expected+='\nNext line.'
  await saved(w=>w.prompt===expected)
  await editor.evaluate(element=>{
    element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}))
    element.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true,keyCode:229}))
    element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))
  })
  assert.equal(submissions,0,'IME Enter and Shift+Enter never submit')

  // Native cursor movement treats an image mention as an atomic editable token.
  await editor.fill('A B')
  await caret(2)
  await insert('Layout sketch')
  await saved(w=>w.prompt==='A [[image:layout]] B')
  await chip('layout').evaluate(element=>{
    const range=document.createRange();range.setStartBefore(element);range.collapse(true)
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)
    element.parentElement.focus()
  })
  await editor.press('ArrowRight')
  await editor.press('Backspace')
  await saved(w=>w.prompt==='A  B')
  assert.equal(await chip('layout').count(),0)
  assert.deepEqual((await api()).workspace.attachments,['walkers','layout'],'deleting a token keeps the attachment')
  await editor.press('ControlOrMeta+z')
  await saved(w=>w.prompt==='A [[image:layout]] B')
  await editor.press('ControlOrMeta+Shift+z')
  await saved(w=>w.prompt==='A  B')

  await caret(null)
  await editor.evaluate(element=>{
    const data=new DataTransfer()
    data.setData('text/plain',' pasted <b>literal</b>')
    data.setData('text/html','<b>formatted HTML</b>')
    element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))
  })
  await saved(w=>w.prompt==='A  B pasted <b>literal</b>')
  assert.equal(await editor.locator('b').count(),0,'pasted HTML is not injected')
  assert.equal(await editor.innerText(),'A  B pasted <b>literal</b>')

  await editor.fill('Use ')
  await caret(null)
  await insert('Layout sketch')
  await page.keyboard.insertText('for shape.')
  await saved(w=>w.prompt==='Use [[image:layout]] for shape.')
  await remove('Layout sketch')
  const detached=await saved(w=>!w.attachments.includes('layout')&&w.prompt==='Use  for shape.')
  assert.equal(await chip('layout').count(),0,'removing an attachment removes its inline references')
  assert.equal(await page.locator('#send').isEnabled(),true,'the remaining prose is still editable and sendable')
  await editor.press('ControlOrMeta+z')
  assert.equal(await chip('layout').count(),0,'editor undo cannot revive a detached token')
  await page.reload()
  assert.equal(await editor.innerText(),'Use  for shape.')

  const oldDraft={...detached,prompt:'Use [[image:layout]] for shape.[[image:unavailable]]'}
  await api('/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(oldDraft)})
  await page.reload()
  const recovered=await saved(w=>w.attachments.includes('layout')&&w.prompt==='Use [[image:layout]] for shape.')
  assert.deepEqual(recovered.attachments,['walkers','layout'])
  assert.equal(await chip('layout').getAttribute('data-missing'),'false','old real references recover on reload')
  assert.equal(await chip('unavailable').count(),0,'unrecoverable tokens are removed without losing prose')
  await caret(null)
  await editor.evaluate(element=>{
    const data=new DataTransfer()
    data.setData('text/plain','[[image:unavailable]]')
    element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))
  })
  assert.equal(await chip('unavailable').count(),0,'raw pasted text cannot create an orphan token')
  await page.locator('#setBtn').click()
  await page.getByRole('radio',{name:'Illustration',exact:true}).click()
  await page.getByRole('radiogroup',{name:'Variations',exact:true}).getByRole('radio',{name:'1',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Send to Sunburst',exact:true}).click()
  await editor.press('Enter')
  await page.locator('#send[data-sent="true"]').waitFor()
  assert.equal(await chip('layout').count(),1,'submission retains inline references')
  await saved(w=>w.prompt==='Use [[image:layout]] for shape.')
  assert.equal(await page.locator('#send').innerText(),'')
  assert.equal(await page.locator('#send').getAttribute('aria-label'),'Submitted')
  const completed=await until(async()=>{const {runs}=await api('/runs');return runs.length===1&&runs[0].status==='done'&&runs[0]})
  assert.equal(completed.prompt,'Use Image 2 for shape.')
  assert.equal(submissions,1)
  await editor.fill('The first draft goes out now.')
  let intercepted, release
  const waiting=new Promise(resolve=>{intercepted=resolve})
  const delayed=new Promise(resolve=>{release=resolve})
  await page.route('**/api/runs?*',async route=>{
    if(route.request().method()!=='POST') return route.continue()
    intercepted()
    await delayed
    await route.continue()
  })
  await editor.press('Enter')
  await waiting
  await page.getByRole('status',{name:'Generating images'}).waitFor()
  await page.getByRole('button',{name:'Clear prompt',exact:true}).click()
  await saved(w=>w.prompt===''&&!w.attachments.length)
  assert.equal(await page.getByRole('button',{name:'Clear prompt',exact:true}).count(),0)
  assert.equal(await editor.evaluate(element=>element===document.activeElement),true)
  await page.getByRole('status',{name:'Generating images'}).waitFor()
  await editor.fill('The second draft stays ready to send.')
  await editor.press('Enter')
  assert.equal(submissions,2,'repeated Enter during submission cannot duplicate it')
  release()
  await page.waitForFunction(()=>document.querySelector('#send')?.getAttribute('aria-busy')==='false')
  assert.equal(await editor.innerText(),'The second draft stays ready to send.')
  assert.equal(await page.locator('#send').isEnabled(),true,'a different draft is immediately sendable')
  await page.unroute('**/api/runs?*')
  await editor.press('Enter')
  await page.locator('#send[data-sent="true"]').waitFor()
  await saved(w=>w.prompt==='The second draft stays ready to send.')
  await until(()=>submissions===3)
  await until(async()=>{const {runs}=await api('/runs');return runs.length===3&&runs.every(run=>run.status==='done')})
  await page.getByRole('status',{name:'Generating images'}).waitFor({state:'hidden'})
  await page.reload()
  await saved(w=>w.prompt==='The second draft stays ready to send.')
  assert.equal(await editor.innerText(),'The second draft stays ready to send.')
  assert.equal(await page.locator('#send').isEnabled(),true,'completed prompts remain reusable after reload')
  const canvas=page.getByRole('region',{name:'Canvas',exact:true})
  const tile=id=>page.locator(`.tile[data-id="${id}"] .board-tile-hit`)
  const setEditTarget=async id=>{
    await tile(id).click()
    await page.locator(`.ctx[data-tile="${id}"]`).getByRole('button',{name:'Edit area',exact:true}).click()
    await page.getByRole('button',{name:'Done',exact:true}).click()
  }
  await canvas.press('0')
  await setEditTarget('layout')
  await editor.fill('Use this shape ')
  await caret(null)
  await insert('Layout sketch')
  await saved(w=>w.target==='layout'&&w.prompt==='Use this shape [[image:layout]] ')
  await setEditTarget('leaves')
  await saved(w=>w.target==='leaves'&&w.attachments.includes('layout'))
  assert.equal(await chip('layout').getAttribute('data-missing'),'false','switching edit targets keeps a still-mentioned image')
  await tile('layout').click()
  await tile('layout').press('Delete')
  await saved(w=>w.deletedImageIds?.includes('layout')&&!w.prompt.includes('[[image:layout]]'))
  assert.equal(await chip('layout').count(),0)
  await canvas.press('ControlOrMeta+z')
  await saved(w=>!w.deletedImageIds?.includes('layout')&&w.prompt.includes('[[image:layout]]'))
  assert.equal(await chip('layout').getAttribute('data-missing'),'false','canvas undo restores the attachment and its token together')
  const preClear=await saved(w=>w.target==='leaves'&&w.attachments.includes('layout'))
  const linked={id:'clear-linked-block',kind:'note',promptBlock:true,text:'Keep this canvas card.',points:[{x:550,y:450}]}
  const withReferences={...preClear,prompt:'Use [[image:layout]] and [[image:walkers]].',target:'layout',attachments:['walkers'],
    annotations:[...preClear.annotations,linked],promptBlockIds:[linked.id]}
  await api('/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(withReferences)})
  await page.reload()
  await page.getByRole('button',{name:'Clear prompt',exact:true}).click()
  const cleared=await saved(w=>w.prompt===''&&w.attachments.length===0&&w.target===null&&w.promptBlockIds?.length===0)
  assert.deepEqual(cleared.settings,withReferences.settings)
  assert.deepEqual(cleared.styleStore,withReferences.styleStore)
  assert.deepEqual(cleared.imageIds,withReferences.imageIds)
  assert.deepEqual(cleared.annotations,withReferences.annotations)
  assert.equal((await api('/runs')).runs.length,3)
  await page.reload()
  assert.equal(await editor.innerText(),'')
  assert.equal(await page.getByRole('button',{name:'Clear prompt',exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log('Inline image references passed: one-time migration, remembered caret, surrounding prose, repeated chips, reordered numbers, reload/newlines/IME, atomic deletion/undo/redo, plain paste, attachment removal and recovery, duplicate-safe submission, and draft clearing.')
}catch(error){
  if(page){
    await page.screenshot({path:'/tmp/charcoal-inline-reference-failure.png',fullPage:true}).catch(()=>{})
    console.error('Visible UI:',await page.locator('body').innerText().catch(()=>''))
    console.error('Editor HTML:',await page.locator('#prompt').innerHTML().catch(()=>''))
    console.error('Workspace:',JSON.stringify((await api()).workspace))
  }
  throw error
}finally{
  await browser?.close()
  if(service&&service.exitCode===null){const stopped=new Promise(resolve=>service.once('exit',resolve));service.kill();await stopped}
  await rm(work,{recursive:true,force:true})
}
