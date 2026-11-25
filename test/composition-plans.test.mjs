import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createCompositionPlans,validatePlan} from '../server/composition-plans.mjs'
import {renderComposition} from '../src/composition-plan.js'
import {openAIProviders} from '../server/providers.mjs'

const plan={alternatives:[
  {title:'Inside the fortress',viewpoint:'Inside looking out',framing:'Tight on the opening',layout:'Hatch at left, receiving hand at right',values:'Small bright hatch in a dark interior',direction:'Show the pebble entering from outside; keep the pencil style.',renderPrompt:'Draw the exchange looking from inside the opening, in the pencil style.'},
  {title:'The enormous wall',viewpoint:'Frontal from across the courtyard',framing:'Wide with a small figure',layout:'Wall fills top four-fifths, tiny hand at lower centre',values:'Small light at lower centre',direction:'Keep the same pebble exchange, seen against the vast wall.',renderPrompt:'Draw the pebble exchange viewed from across the courtyard, in the pencil style.'},
]}
const input={id:'batch-1',prompt:'A hand passes a pebble into a fortress.',userBrief:'A hand passes a pebble into a fortress.',inputs:['ref'],count:2,contractVersion:4}
function store(){const data=new Map();return {get:(k,f)=>data.has(k)?data.get(k):f,set:(k,v)=>data.set(k,v),getAsset:id=>id==='ref'?{id}:null,readAsset:()=>({bytes:Buffer.from('reference')})}}

test('the literal user brief reaches the planner separately and participates in durable identity',async t=>{
  const userBrief="Image 1 Keep almost everything exactly as it is. Apply the dress brown to the wheel. Brighten the background and basket wool slightly."
  let body,calls=0
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    calls++;body=JSON.parse(options.body)
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})
  })
  const saved=store(),runtime={engine:openAIProviders('test-only')}
  const planner=createCompositionPlans(saved,runtime)
  const request={...input,userBrief,prompt:'Colour variation. Use visibly different palettes. No visible beams of sunlight.'}
  await planner.create(request)
  const text=body.input[0].content.filter(x=>x.type==='input_text').map(x=>x.text)
  assert.ok(text.includes('User brief (authoritative, preserve its wording):\n'+userBrief))
  assert.ok(text.some(x=>x.startsWith('App context and defaults (subordinate to the user brief):\n')))
  await createCompositionPlans(saved,runtime).create(request)
  assert.equal(calls,1)
  await assert.rejects(planner.create({...request,userBrief:userBrief+' Keep the background neutral.'}),/different brief/)
})

test('new planning requires the literal brief and preserves cached version-two requests',async()=>{
  const saved=store();let calls=0
  const planner=createCompositionPlans(saved,{engine:{planCompositions:()=>{calls++;return plan}}})
  await assert.rejects(planner.create({...input,id:'missing',userBrief:undefined}),/user brief/i)
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const {userBrief:_,...legacy}=input;legacy.contractVersion=2
  const {id,prompt,inputs,count,contractVersion}=legacy
  saved.set('composition-plan:'+id,{fingerprint:hash(JSON.stringify({prompt,inputs,inputHashes:[hash('reference')],count,contractVersion})),plan})
  assert.deepEqual(await planner.create(legacy),plan)
  await assert.rejects(planner.create({...legacy,id:'fresh-v2'}),/reload Charcoal/i)
  assert.equal(calls,0)
})

test('filename-era version-three plans remain readable but cannot create fresh batches',async()=>{
  const saved=store();let calls=0
  const planner=createCompositionPlans(saved,{engine:{planCompositions:()=>{calls++;return plan}}})
  const legacy={...input,contractVersion:3}
  const {id,prompt,userBrief,inputs,count,contractVersion}=legacy
  const hash=value=>createHash('sha256').update(value).digest('hex')
  saved.set('composition-plan:'+id,{fingerprint:hash(JSON.stringify({prompt,inputs,inputHashes:[hash('reference')],count,contractVersion,userBrief})),plan})
  assert.deepEqual(await planner.create(legacy),plan)
  await assert.rejects(planner.create({...legacy,id:'fresh-v3'}),/reload Charcoal/i)
  assert.equal(calls,0)
})

test('one shared plan is reused for simultaneous requests and after reload',async()=>{
  let calls=0,finish
  const engine={planCompositions:()=>{calls++;return new Promise(resolve=>{finish=resolve})}}
  const saved=store(),runtime={engine}
  const planner=createCompositionPlans(saved,runtime)
  const first=planner.create(input),second=planner.create(input)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls,1)
  assert.equal(planner.busy,true)
  finish(plan)
  assert.deepEqual(await first,plan)
  assert.deepEqual(await second,plan)
  assert.deepEqual(await createCompositionPlans(saved,runtime).create(input),plan)
  assert.equal(calls,1)
  assert.equal(planner.busy,false)
  await assert.rejects(planner.create({...input,prompt:'A different brief'}),/different brief/)
})

test('duplicate layouts, missing alternatives and malformed plans fail before rendering',()=>{
  assert.throws(()=>validatePlan({alternatives:[plan.alternatives[0],{...plan.alternatives[0],title:'Second'}]},2),/distinct/)
  assert.throws(()=>validatePlan(plan,3),/alternatives/)
  assert.throws(()=>validatePlan({alternatives:[{title:'Only title'}]},1),/incomplete/)
  const first=renderComposition('Original subject and style.',plan,0)
  const second=renderComposition('Original subject and style.',plan,1)
  assert.match(first,/from inside the opening/)
  assert.doesNotMatch(first,/across the courtyard/)
  assert.match(second,/across the courtyard/)
  assert.doesNotMatch(second,/Original subject and style/)
  const missing={...plan.alternatives[1],renderPrompt:' '}
  assert.throws(()=>validatePlan({alternatives:[plan.alternatives[0],missing]},2),/incomplete/)
  const duplicate={...plan.alternatives[1],renderPrompt:plan.alternatives[0].renderPrompt}
  assert.throws(()=>validatePlan({alternatives:[plan.alternatives[0],duplicate]},2),/distinct/)
})

test('a narrow edit may preserve all composition fields while varying only its small adjustment',()=>{
  const preserved={title:'Small lift',viewpoint:'Unchanged',framing:'Unchanged',layout:'Unchanged',values:'Lighten background',direction:'Keep dappled light and style.'}
  const small={alternatives:[
    {...preserved,renderPrompt:'Image 1 Make the background a bit lighter. Keep everything else the same. Use a very slight lift.'},
    {...preserved,renderPrompt:'Image 1 Make the background a bit lighter. Keep everything else the same. Use a slightly larger lift, still restrained.'},
  ]}
  assert.equal(validatePlan(small,2),small)
})

test('interrupted or failed planning is not silently charged again',async()=>{
  const saved=store();let calls=0
  const planner=createCompositionPlans(saved,{engine:{planCompositions:async()=>{calls++;throw Error('Unavailable')}}})
  await assert.rejects(planner.create(input),/Unavailable/)
  await assert.rejects(createCompositionPlans(saved,{engine:{planCompositions:()=>{calls++}}}).create(input),/Unavailable/)
  assert.equal(calls,1)
})

test('planner sends the complete brief and both images in one structured request',async t=>{
  let calls=0,body,url
  t.mock.method(globalThis,'fetch',async(address,options)=>{
    calls++;url=address;body=JSON.parse(options.body)
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})
  })
  const prompt = input.prompt + ' Use image 1 for its layered depth and image 2 for the pebble shape.'
  const providers = openAIProviders('test-only','test-reviewer')
  assert.equal(providers.reviewer.model,'test-reviewer')
  assert.deepEqual(await providers.planCompositions({prompt,count:2},[Buffer.from('first'),Buffer.from('second')]),plan)
  assert.equal(calls,1)
  assert.match(url,/responses$/)
  assert.equal(body.model,'gpt-6.2-sol')
  assert.deepEqual(body.reasoning,{effort:'high'})
  assert.match(body.instructions,/Compare every pair/)
  assert.match(body.instructions,/depth through layering, scale and overlaps/)
  assert.match(body.instructions,/functional parts connected/)
  assert.deepEqual(body.input[0].content.filter(part=>part.type==='input_text').map(part=>part.text),
    [`Plan 2 distinct composition alternatives for this brief:
${prompt}`,'Image 1:','Image 2:'])
  assert.deepEqual(body.input[0].content.filter(part=>part.type==='input_image').map(part=>part.image_url),
    ['first','second'].map(text=>'data:image/png;base64,'+Buffer.from(text).toString('base64')))
  assert.equal(body.text.format.name,'composition_plan')
  assert.equal(body.text.format.strict,true)
})

test('lighting planning is durable and assigns one scene-specific direction to each render',async()=>{
  const lighting={alternatives:[
    {title:'Lamp after dark',approach:'Hard upward light from the lamp, windows unlit',application:'Bright wedge above the lamp and deep shadow across both curtains',direction:'Remove the leafy cast shadows from the wall.',renderPrompt:'Use a bright wedge above the lamp and remove the leafy cast shadows.'},
    {title:'Overcast daylight',approach:'Soft light through both windows, lamp unlit',application:'Broad midtones on the wall and gentle folds in the curtains',direction:'Replace the wall’s dapple with an even gradient.',renderPrompt:'Use soft overcast daylight and replace the wall’s dapple with an even gradient.'},
  ]}
  let calls=0
  const planner=createCompositionPlans(store(),{engine:{planCompositions:async ({axis})=>{
    assert.equal(axis,'lighting')
    calls++
    return lighting
  }}})
  const request={...input,axis:'lighting',prompt:'Two identical windows with one curtain on each.'}
  assert.deepEqual(await planner.create(request),lighting)
  assert.deepEqual(await planner.create(request),lighting)
  assert.equal(calls,1)
  await assert.rejects(planner.create({...request,axis:'colour'}),/different brief/)
  const first=renderComposition(request.prompt,lighting,0,'lighting')
  assert.doesNotMatch(first,/Assigned lighting: Lamp after dark/)
  assert.match(first,/bright wedge above the lamp/)
  assert.doesNotMatch(first,/Overcast daylight/)
  assert.throws(()=>validatePlan({alternatives:[lighting.alternatives[0],{...lighting.alternatives[0],title:'Second'}]},2,'lighting'),/distinct/)
})

test('treatment planning uses creative reasoning and gives the planner the source and reference roles',async t=>{
  const result={alternatives:[
    {title:'Even daylight',approach:'Diffuse window light',application:'Midtone curtains',direction:'Remove dapple from the wall.',renderPrompt:'Illuminate the curtains through the window with diffuse light and without dapple.'},
    {title:'Lamp after dark',approach:'Hard light from below',application:'Bright lamp wedge',direction:'Keep both windows dark.',renderPrompt:'Illuminate the lamp sharply from below and keep both windows dark.'},
  ]}
  const prompt='Relight image 1. Use image 2 for edge treatment only.'
  let body
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    body=JSON.parse(options.body)
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})
  })
  const images=[Buffer.from('source'),Buffer.from('edge reference')]
  assert.deepEqual(await openAIProviders('test-only','test-reviewer').planCompositions({prompt,count:2,axis:'lighting'},images),result)
  assert.equal(body.model,'gpt-6.2-sol')
  assert.deepEqual(body.reasoning,{effort:'high'})
  assert.match(body.instructions,/broad light and dark masses/)
  assert.ok(body.input[0].content[0].text.includes(prompt))
  assert.deepEqual(body.input[0].content.filter(part=>part.type==='input_image').map(part=>part.image_url),
    images.map(bytes=>'data:image/png;base64,'+bytes.toString('base64')))
  assert.equal(body.text.format.name,'treatment_plan')
})

test('a persisted legacy fingerprint remains readable without creating a fresh legacy plan',async()=>{
  const {contractVersion:_,userBrief:__,...legacy}=input
  const {id,prompt,inputs,count}=legacy
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const saved=store()
  const oldPlan={alternatives:plan.alternatives.map(({renderPrompt:_,...fields})=>fields)}
  const fingerprint=hash(JSON.stringify({prompt,inputs,inputHashes:[hash('reference')],count}))
  saved.set(`composition-plan:${id}`,{fingerprint,plan:oldPlan})
  let calls=0
  const planner=createCompositionPlans(saved,{engine:{planCompositions:()=>{calls++;return plan}}})
  assert.deepEqual(await planner.create(legacy),oldPlan)
  await assert.rejects(planner.create({...legacy, id:'new-legacy'}),/reload Charcoal/i)
  await assert.rejects(planner.create(input),/different brief/)
  assert.equal(calls,0)
})

test('a local freeform plan uses distinct durable context and sends only aligned alternatives',async t=>{
  const regional={alternatives:[
    {title:'Warm edge', approach:'Colour', application:'Chestnut wedge', direction:'Follow mask', renderPrompt:'Give the marked part of the wheel a chestnut edge. Keep its shape unchanged.'},
    {title:'Bright edge', approach:'Values', application:'Bright wedge', direction:'Follow mask', renderPrompt:'Lighten the marked part of the wheel. Keep its shape unchanged.'},
  ]}
  let calls=0, instructions
  t.mock.method(globalThis,'fetch',async (_url,{body})=>{
    calls++
    instructions=JSON.parse(body).instructions
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(regional)}]}]})
  })
  const planner=createCompositionPlans(store(),{engine:openAIProviders('test-only')})
  const request={...input,axis:'freeform',regionalEdit:true}
  assert.deepEqual(await planner.create(request),regional)
  assert.deepEqual(await planner.create(request),regional)
  await assert.rejects(planner.create({...request,regionalEdit:false}),/different brief/)
  await assert.rejects(planner.create({...request,axis:'composition'}),/planning contract/)
  assert.match(instructions,/Apply the change at the marked area only/)
  assert.match(instructions,/preserve framing and alignment/)
  assert.equal(calls,1)
})

test('recovery reads the original plan without dispatch and checks accepted assignments',async()=>{
  const saved=store()
  const ids=[input.id,'second']
  saved.set('workspace',{pendingSubmission:{ids,recoveryOnly:true}})
  let calls=0
  const planner=createCompositionPlans(saved,{engine:{planCompositions:()=>{calls++;return plan}}})
  assert.equal(planner.recover(input.id),null)
  await assert.rejects(planner.create(input),/original batch plan is unavailable/)
  saved.set('composition-plan:'+input.id,{fingerprint:'v3',plan})
  saved.set('runs',[{id:input.id,prompt:renderComposition(input.prompt,plan,0)}])
  assert.equal(planner.recover(input.id),plan)
  saved.set('runs',[{id:input.id,prompt:renderComposition(input.prompt,plan,1)}])
  assert.equal(planner.recover(input.id),null)
  assert.equal(calls,0)
})

test('the planner can return a faithful render brief longer than 4,000 characters',async()=>{
  const userBrief='Preserve the hatch inscriptions exactly. '.repeat(118).trim()
  const long={alternatives:plan.alternatives.map(option=>({...option,renderPrompt:userBrief+' '+option.renderPrompt}))}
  let calls=0
  const planner=createCompositionPlans(store(),{engine:{planCompositions:request=>{
    calls++
    assert.equal(request.userBrief,userBrief)
    return long
  }}})
  const result=await planner.create({...input,userBrief})
  for(const mode of ['composition','lighting','illustration']) {
    for(const index of [0,1]) {
      const prompt=renderComposition('Whole-batch directions',result,index,'composition',mode)
      assert.ok(prompt.startsWith(userBrief+' '+plan.alternatives[index].renderPrompt))
      assert.equal(prompt.includes('black-and-white (grayscale)'),mode!=='illustration')
      assert.ok(!prompt.includes('Whole-batch directions'))
      assert.ok(!prompt.includes(plan.alternatives[1-index].renderPrompt))
    }
  }
  await assert.rejects(planner.create({...input,id:'too-long',userBrief:'a'.repeat(20_001)}),{status:400})
  assert.equal(calls,1)
})

test('cached recovery validates each outstanding render including the study instructions',()=>{
  const saved=store()
  const planner=createCompositionPlans(saved,{})
  const ids=[input.id,'remaining']
  saved.set('workspace',{studyMode:'composition',pendingSubmission:{ids}})
  const exact='x'.repeat(24000-renderComposition('',{alternatives:[{renderPrompt:'x'}]},0,undefined,'composition').length+1)
  for(const [renderPrompt,valid] of [[exact,true],[exact+'x',false]]) {
    const cached={alternatives:[plan.alternatives[0],{renderPrompt}]}
    saved.set('composition-plan:'+input.id,{plan:cached})
    assert.equal(planner.recover(input.id),valid?cached:null)
  }
})
