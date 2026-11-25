import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as pause} from 'node:timers/promises'
import {chromium} from 'playwright'

const batches = [
  {axis:'colour', prompt:'Keep the walkers and their linework. Change only the palette; keep the existing shadow shapes.',
    alternatives:[
      {title:'Copper and petrol', approach:'Warm walls and cool shade', application:'Assign copper to the lit ground and petrol blue to the shadow shapes.', direction:'Keep the lines and shadow boundaries.'},
      {title:'Lavender and moss', approach:'Cool ground with earthy accents', application:'Use pale lavender on the ground and deep moss on the walkers.', direction:'Keep the lines and shadow boundaries.'},
      {title:'Ochre and violet', approach:'Yellow ground against purple shade', application:'Use ochre on the ground and violet in the shade.', direction:'Keep the lines and shadow boundaries.'},
    ]},
  {axis:'style', prompt:'Keep the walkers, monochrome palette, and lighting. Change the mark-making.',
    alternatives:[
      {title:'Drypoint', approach:'Fine incised hatching', application:'Describe the walkers with needle lines and the ground with short crosshatching.', direction:'Render in black and white and retain the light-dark pattern.'},
      {title:'Paper cutout', approach:'Flat cut shapes', application:'Build both walkers from cut silhouettes with crisp joins.', direction:'Use grayscale paper and preserve the shadow shapes.'},
      {title:'Charcoal', approach:'Broad charcoal strokes', application:'Describe the walkers with compressed charcoal and place soft strokes in the shaded ground.', direction:'Remain monochrome and preserve the shadow placements.'},
    ]},
]

for(const batch of batches) for(const alternative of batch.alternatives) alternative.renderPrompt=`Depict the walkers from Image 1. ${alternative.application} ${alternative.direction}`
batches[0].prompt='Give me three subtle colour variations for Image 1: one copper and petrol, one lavender and moss, and one ochre and violet. Keep the walkers and existing shadow shapes.'
batches.push({axis:'freeform',prompt:'Blend these three images into three distinct interpretations. You choose which aspects to explore.',alternatives:[
 {title:'Airy',approach:'Open framing',application:'Widely spaced silhouettes',direction:'An airy single scene',renderPrompt:'Combine the walkers in Image 1 with the layout from Image 2 and the colours in Image 3, using broad open shapes.'},
 {title:'Close',approach:'Close framing',application:'Overlapping shapes',direction:'A close single scene',renderPrompt:'Combine the walkers in Image 1 with the layout from Image 2 and the colours in Image 3, using tightly overlapping shapes.'},
 {title:'Pattern',approach:'Graphic pattern',application:'Rhythmic marks',direction:'A patterned single scene',renderPrompt:'Combine the walkers in Image 1 with the layout from Image 2 and the colours in Image 3, using rhythmic patterned marks.'},
]})

const work = await mkdtemp(join(tmpdir(),'charcoal-axis-test-'))
const trace = join(work,'provider.jsonl')
const stub = join(work,'stub.mjs')
const port = process.env.CHARCOAL_TEST_PORT ?? '4383'
const url = `http://127.0.0.1:${port}`
const api = async path => {
  const response = await fetch(url+'/api'+path)
  assert.equal(response.ok,true,await response.clone().text())
  return response.json()
}
const recorded = async () => (await readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
async function until(predicate) {
  for (let elapsed=0; elapsed<20000; elapsed+=100) {
    const value = await predicate()
    if (value) return value
    await pause(100)
  }
  assert.fail('Timed out waiting for the variation batch')
}

let service,browser
try {
  await writeFile(trace,'')
  await writeFile(stub,`
    import {appendFile, readFile} from 'node:fs/promises'
    import assert from 'node:assert/strict'
    const batches = ${JSON.stringify(batches)}
    const art = await readFile('public/samples/walkers.png')
    const log = value => appendFile(${JSON.stringify(trace)}, JSON.stringify(value)+'\\n')
    globalThis.fetch = async (url, {body}) => {
      const route = new URL(url).pathname
      if (route === '/v1/responses') {
        const {input} = JSON.parse(body)
        const content = input.flatMap(message => message.content)
        const text = content.filter(item => item.type === 'input_text').map(item => item.text).join('\\n')
        const batch = batches.find(({prompt}) => text.includes(prompt))
        assert.ok(batch,'Unexpected planning request: '+text)
        const images = content.filter(item => item.type === 'input_image')
        assert.equal(images.length,batch.axis==='freeform'?3:1)
        assert.deepEqual(Buffer.from(images[0].image_url.split(',')[1],'base64'),art)
        await log({route,axis:batch.axis,text})
        return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({alternatives:batch.alternatives})}]}]})
      }
      assert.equal(route,'/v1/images/edits')
      const images = body.getAll('image[]')
      assert.ok(images.length===1||images.length===3)
      assert.deepEqual(Buffer.from(await images[0].arrayBuffer()),art)
      await log({route,prompt:body.get('prompt'),count:body.get('n')})
      return Response.json({data:[{b64_json:art.toString('base64')}]})
    }
  `)
  service = spawn(process.execPath,['--import',stub,'server/index.mjs'],{
    env:{...process.env,CHARCOAL_PORT:port,CHARCOAL_DEMO:'1',CHARCOAL_FIXTURE:'0',CHARCOAL_DATA_DIR:work,OPENAI_API_KEY:'stub'},
    stdio:['ignore','pipe','inherit'],
  })
  await new Promise((resolve,reject) => {
    service.stdout.on('data',chunk=>{if (String(chunk).includes('Charcoal on')) resolve()})
    service.once('exit',code=>reject(new Error(`Fixture server exited with status ${code}`)))
  })
  browser = await chromium.launch({channel:'chrome'})
  const page = await browser.newPage({viewport:{width:1248,height:800},reducedMotion:'reduce'})
  const plannerAxes = []
  const literalBriefs = []
  page.on('request',request=>{
    if (request.method()==='POST' && new URL(request.url()).pathname==='/api/composition-plans') {
      plannerAxes.push(request.postDataJSON().axis)
      literalBriefs.push(request.postDataJSON().userBrief)
    }
  })
  await page.goto(url)
  await page.locator('.tile[data-id="walkers"] .board-tile-hit').click()
  await page.getByRole('button',{name:'Add Two walkers to prompt',exact:true}).click()
  const inheritedName="Image 1 reduce the detail in the woman's hair.png"
  const renamed=await fetch(url+'/api/assets/walkers',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:inheritedName})})
  assert.equal(renamed.ok,true)
  await page.reload()
  let index = 0
  for (const {axis,prompt,alternatives} of batches) {
    if(axis==='freeform'){
      const state=await api('/state')
      const response=await fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state.workspace,attachments:['walkers','layout','swatches'],target:null,styleStore:{...state.workspace.styleStore,activeId:null}})})
      assert.equal(response.ok,true);await page.reload()
    }
    const before = new Set((await api('/runs')).runs.map(run=>run.id))
    await page.locator('#prompt').fill(prompt+' Use ')
    await page.getByRole('button',{name:'Insert reference to '+inheritedName,exact:true}).click()
    await page.locator('#setBtn').click()
    await page.getByRole('radiogroup',{name:'Vary',exact:true}).getByRole('radio',{name:axis==='colour'?'Colour':axis==='style'?'Style':'Freeform',exact:true}).click()
    await page.getByRole('radiogroup',{name:'Variations',exact:true}).getByRole('radio',{name:'3',exact:true}).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button',{name:'Send to Sunburst'}).click()
    const runs = await until(async()=>{
      const batch = (await api('/runs')).runs.filter(run=>!before.has(run.id))
      assert.ok(batch.every(run=>!['failed','uncertain'].includes(run.status)),JSON.stringify(batch))
      return batch.length===3 && batch.every(run=>run.status==='done') && batch
    })
    const [plan,...edits] = (await recorded()).slice(index,index+4)
    assert.equal(plan.route,'/v1/responses')
    assert.equal(plan.axis,axis)
    assert.ok(plan.text.includes(prompt))
    assert.ok(plan.text.includes('Image 1'))
    assert.ok(!plan.text.includes(inheritedName),'Display names do not enter planning context')
    assert.equal(edits.length,alternatives.length)
    for (const [i,alternative] of alternatives.entries()) {
      const edit = edits[i]
      assert.equal(edit.route,'/v1/images/edits')
      assert.equal(edit.count,'1')
      assert.ok(!edit.prompt.includes(inheritedName),'Display names do not enter renderer instructions')
      assert.ok(edit.prompt.includes(alternative.renderPrompt)); assert.ok(!edit.prompt.includes(prompt)); assert.ok(!edit.prompt.includes(alternative.title))
      for (const sibling of alternatives.filter(item=>item!==alternative)) assert.ok(!edit.prompt.includes(sibling.title))
      const run = runs.find(run=>run.effectivePrompt===edit.prompt)
      assert.ok(run,'The saved effective prompt matches the provider request')
      assert.deepEqual(run.inputs,axis==='freeform'?['walkers','layout','swatches']:['walkers'])
      assert.equal(run.target,null)
      assert.equal(run.candidates.length,1)
    }
    index += 4
  }
  assert.deepEqual(plannerAxes,batches.map(({axis})=>axis))
  assert.deepEqual(literalBriefs,batches.map(({prompt})=>prompt+' Use Image 1'),'The coordinator receives the literal resolved draft, without app scaffolding or preset instructions')
  assert.equal((await recorded()).length,12)
  await page.setViewportSize({width:390,height:844})
  await page.reload()
  await page.locator('#setBtn').click()
  const vary=page.getByRole('radiogroup',{name:'Vary',exact:true})
  assert.equal(await vary.getByRole('radio',{name:'Freeform',exact:true}).getAttribute('aria-checked'),'true','Freeform survives reload')
  for(const radio of await vary.getByRole('radio').all()) {
    const rect=await radio.boundingBox()
    assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=390&&rect.y>=0&&rect.y+rect.height<=844,'Every variation choice fits the narrow viewport')
  }
  await page.screenshot({path:'/tmp/charcoal-freeform-narrow.png'})
  console.log('Colour, style and Freeform each used one shared plan and three isolated image edits. Freeform preserves three references, survives reload and fits at 390px.')
} finally {
  await browser?.close()
  if (service && service.exitCode===null) {
    const stopped = new Promise(resolve=>service.once('exit',resolve))
    service.kill()
    await stopped
  }
  await rm(work,{recursive:true,force:true})
}
