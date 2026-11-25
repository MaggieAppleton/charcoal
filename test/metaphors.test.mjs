import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMetaphors,METAPHOR_INSTRUCTION,metaphorFormat,validateMetaphors,validMetaphorMetadata} from '../server/metaphors.mjs'
import {openAIProviders,fixtureProviders} from '../server/providers.mjs'
import {openStore} from '../server/store.mjs'

const options=[
  {title:'The mail slot',scene:'A hand slips one envelope through the mail slot of a closed door.',meaning:'One item passes through while the rest stays closed off.',caveat:'It may suggest the handoff works in only one direction.'},
  {title:'One drop',scene:'An eyedropper releases one drop into a glass.',meaning:'The drop is a portion measured for the job at hand.',caveat:'It may imply the right amount is always easy to measure.'},
  {title:'One lit shelf',scene:'A spotlight lights a single shelf in an otherwise dark bookcase.',meaning:'Only the relevant part of a larger collection is made visible.',caveat:'The shadows may suggest the other material is hard to find.'},
]
const draft={id:'request-1',context:'A helper should receive only the information needed for one task. The article also discusses audit records and when access expires.'}
const earlierOption={...options[0],scene:'A hand feeds documents through a fortress hatch while one guard checks a clock and another writes in a ledger.'}
const refinement={...draft,id:'refinement-1',option:earlierOption,feedback:'Make it clear that only one item passes through. Keep the handoff.'}
const fakeStore=()=>{const data=new Map();return {get:(key,fallback)=>data.has(key)?data.get(key):fallback,set:(key,value)=>data.set(key,value)}}

test('one exploration serves concurrent callers and survives service recreation',async()=>{
  let calls=0,finish
  const store=fakeStore(),runtime={engine:{exploreMetaphors:()=>{calls++;return new Promise(resolve=>{finish=resolve})}}}
  const service=createMetaphors(store,runtime)
  const first=service.explore(draft),second=service.explore(draft)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls,1)
  assert.equal(service.busy,true)
  finish({options})
  assert.deepEqual(await first,{options})
  assert.deepEqual(await second,{options})
  assert.equal(service.busy,false)
  assert.deepEqual(await createMetaphors(store,runtime).explore(draft),{options})
  assert.equal(calls,1)
  await assert.rejects(service.explore({...draft,context:'Changed brief'}),/different brief/)
})

test('refinement receives original context, selected option and feedback and returns one option',async()=>{
  let received
  const service=createMetaphors(fakeStore(),{engine:{exploreMetaphors:async input=>{received=input;return {options:[options[0]]}}}})
  assert.deepEqual(await service.explore(refinement),{options:[options[0]]})
  assert.deepEqual(received,{context:draft.context,option:earlierOption,feedback:refinement.feedback})
  await assert.rejects(service.explore({...draft,id:'missing-feedback',option:options[0]}),/feedback/)
})

test('malformed or duplicate output fails closed, and failed calls never silently repeat',async()=>{
  assert.throws(()=>validateMetaphors({options:[options[0]]},3),/three/)
  assert.throws(()=>validateMetaphors({options:[options[0],options[0],options[2]]},3),/distinct/)
  assert.throws(()=>validateMetaphors({options:[{title:'Empty'}]},1),/incomplete/)
  let calls=0
  const store=fakeStore(),runtime={engine:{exploreMetaphors:async()=>{calls++;throw Error('Unavailable')}}}
  await assert.rejects(createMetaphors(store,runtime).explore(draft),/Unavailable/)
  await assert.rejects(createMetaphors(store,runtime).explore(draft),/Unavailable/)
  assert.equal(calls,1)
})

test('metadata validation accepts drafts/history and rejects malformed imported content',()=>{
  assert.equal(validMetaphorMetadata({kind:'brief',title:'',context:''}),true)
  assert.equal(validMetaphorMetadata({kind:'option',context:draft.context,...options[0],briefId:'brief-1',history:[options[1]],request:{id:'request-1',fingerprint:'draft'}}),true)
  assert.equal(validMetaphorMetadata({kind:'brief',title:'Brief',context:'x'.repeat(100001)}),false)
  assert.equal(validMetaphorMetadata({kind:'option',title:'Option',context:'Context',history:Array(21).fill(options[0])}),false)
  assert.equal(validMetaphorMetadata({kind:'brief',title:'Brief',context:'Context',request:{id:'bad / id',fingerprint:'draft'}}),false)
})

test('the provider receives the scene and revision guidance with the literal request payloads',async t=>{
  const requests=[]
  const comparison={
    id:'comparison-1',
    context:'  The shortcut takes less time than the detour.\nTravel times vary with the weather.  ',
    option:{
      title:'Two routes',
      scene:'One path crosses a footbridge while a longer path follows the bank past markers and benches.',
      meaning:'Both paths reach the same place, but the bridge is a shortcut.',
      caveat:'Neither route has a guaranteed travel time.',
    },
    feedback:'  Keep both routes and their shared destination.\nRemove the markers and benches.  ',
  }
  const revisedComparison={...comparison.option,scene:'A footbridge and a longer path along the bank lead to the same gate.'}
  const appended={...options[2],title:'One open drawer',scene:'One drawer opens in a locked cabinet.'}
  const append={...draft,id:'append-1',count:1,exclusions:options}
  const replies=[{options},{options:[revisedComparison]},{options:[appended]}]
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses')
    const reply=replies[requests.length]
    requests.push(JSON.parse(init.body))
    assert.ok(reply,'Unexpected extra provider call')
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(reply)}]}]})
  })
  const dir=mkdtempSync(join(tmpdir(),'charcoal-metaphors-'))
  const runtime={engine:openAIProviders('test-only','lightweight-review-model')}
  assert.equal(runtime.engine.reviewer.model,'lightweight-review-model')
  assert.deepEqual(runtime.engine.metaphor,{model:'gpt-6.2-sol',reasoningEffort:'high'})
  const readOptions=async()=>{
    const store=openStore(dir)
    try {
      const service=createMetaphors(store,runtime)
      assert.deepEqual(await service.explore(draft),replies[0])
      assert.deepEqual(await service.explore(comparison),replies[1])
      assert.deepEqual(await service.explore(append),replies[2])
    } finally {
      store.close()
    }
  }
  try {
    await readOptions()
    await readOptions()
  } finally {
    rmSync(dir,{recursive:true,force:true})
  }

  assert.equal(requests.length,3)
  for(const body of requests) {
    assert.equal(body.model,'gpt-6.2-sol','exploration and refinement use the dedicated creative model')
    assert.deepEqual(body.reasoning,{effort:'high'})
    assert.deepEqual(body.text.format,metaphorFormat)
    assert.equal(body.instructions,METAPHOR_INSTRUCTION)
    assert.match(body.instructions,/one core abstract relationship/i)
    assert.match(body.instructions,/thumbnail size/)
    assert.match(body.instructions,/one short sentence by default/)
    assert.match(body.instructions,/without its title/)
    assert.match(body.instructions,/supporting facts.*meaning/i)
    assert.match(body.instructions,/smallest visible change/)
    assert.match(body.instructions,/preserve.*comparisons/i)
    assert.match(body.instructions,/asks for a new metaphor.*different familiar situation/i)
    assert.match(body.instructions,/source material/)
    assert.match(body.instructions,/unsupported/)
    const [{role,content}]=body.input
    assert.equal(role,'user')
    assert.equal(content.length,1)
    assert.equal(content[0].type,'input_text')
  }
  assert.equal(requests[0].input[0].content[0].text,`Return exactly 3 options.\nContext:\n${draft.context}`)
  assert.equal(requests[1].input[0].content[0].text,
    `Return exactly 1 option.\nContext:\n${comparison.context}\nSelected metaphor:\n${JSON.stringify(comparison.option)}\nArt director feedback:\n${comparison.feedback}`)
  const appendRequest=requests[2].input[0].content[0].text
  assert.match(appendRequest,/^Return exactly 1 option/)
  assert.match(appendRequest,/Add one new analogy/)
  assert.ok(appendRequest.includes(JSON.stringify(options)))
  assert.match(METAPHOR_INSTRUCTION,/Avoid conceptual repeats/)
})

test('a pre-revision cached result replays after reopening without a provider call',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'charcoal-metaphors-legacy-'))
  const result={options:[earlierOption,...options.slice(1)]}
  let calls=0
  let store=openStore(dir)
  try {
    // This fingerprint was generated from the original context-only request.
    store.set('metaphor-request:request-1',{
      fingerprint:'ba0664745f2e858784d759283bd2d6a547ac296c7d794ed4146e9fe1a1bcbba9',
      result,
    })
    store.close()
    store=openStore(dir)
    const runtime={engine:{exploreMetaphors:async()=>{calls++;throw Error('Unexpected provider call')}}}
    const service=createMetaphors(store,runtime)
    assert.deepEqual(await service.explore(draft),result)
    assert.deepEqual(await service.explore({...draft,cacheOnly:true}),result)
    assert.equal(calls,0)
  } finally {
    store.close()
    rmSync(dir,{recursive:true,force:true})
  }
})

test('fixture exploration and refinement use the same result contract',async()=>{
  const provider=fixtureProviders(new URL('../public/samples/',import.meta.url))
  validateMetaphors(await provider.exploreMetaphors({context:draft.context}),3)
  validateMetaphors(await provider.exploreMetaphors({context:draft.context,option:options[0],feedback:'Make it quieter.'}),1)
})

test('same request ID on separate boards has independent context and results',async()=>{
  let calls=0
  const runtime={engine:{exploreMetaphors:async()=>{calls++;return {options}}}}
  const first=createMetaphors(fakeStore(),runtime),second=createMetaphors(fakeStore(),runtime)
  await first.explore(draft)
  await second.explore({...draft,context:'A separate board with a different idea.'})
  assert.equal(calls,2)
})

test('interrupted planning and invalid input never dispatch another paid call',async()=>{
  const store=fakeStore();let calls=0
  const runtime={engine:{exploreMetaphors:()=>{calls++;return new Promise(()=>{})}}}
  const first=createMetaphors(store,runtime)
  void first.explore(draft)
  await new Promise(resolve=>setImmediate(resolve))
  await assert.rejects(createMetaphors(store,runtime).explore(draft),/interrupted/)
  await assert.rejects(first.explore({...draft,id:'bad/id'}),/Add context/)
  await assert.rejects(first.explore({...draft,id:'empty',context:''}),/Add context/)
  await assert.rejects(first.explore({...draft,id:'oversized',context:'x'.repeat(100001)}),/100,000/)
  assert.equal(calls,1)
})


test('append recovery is cache-only on import and fingerprints the count and exact exclusions',async()=>{
  const store=fakeStore()
  const append={...draft,count:1,exclusions:[options[0]]}
  let calls=0
  const runtime={engine:{exploreMetaphors:async()=>{calls++;return {options:[options[2]]}}}}
  const service=createMetaphors(store,runtime)
  await assert.rejects(service.explore({...append,cacheOnly:true}),/No saved result/)
  assert.equal(calls,0)
  const result=await service.explore(append)
  assert.deepEqual(await createMetaphors(store,runtime).explore({...append,cacheOnly:true}),result)
  await assert.rejects(createMetaphors(fakeStore(),runtime).explore({...append,cacheOnly:true}),/No saved result/)
  await assert.rejects(service.explore({...append,exclusions:[]}),/different brief/)
  await assert.rejects(service.explore({...draft,count:3}),/different brief/)
  assert.equal(calls,1)
})

test('append caches a failure on an exact normalized scene repeat',async()=>{
  let calls=0
  const repeated={...options[0],title:'A rewritten title',scene:'A HAND slips one envelope, through the mail slot of a closed door!'}
  const service=createMetaphors(fakeStore(),{engine:{exploreMetaphors:async()=>{calls++;return {options:[repeated]}}}})
  const append={...draft,count:1,exclusions:[options[0]]}
  await assert.rejects(service.explore(append),/repeated an option/)
  await assert.rejects(service.explore({...append,cacheOnly:true}),/repeated an option/)
  assert.equal(calls,1)
})

test('brief metadata validates dismissed options and frozen append payloads',()=>{
  const brief={kind:'brief',title:'Brief',context:draft.context,explored:true,dismissedOptions:{dismissed:options[0]},
    request:{id:'pending',payload:{context:draft.context,count:1,exclusions:[options[0]]}}}
  assert.equal(validMetaphorMetadata(brief),true)
  assert.equal(validMetaphorMetadata({...brief,dismissedOptions:{dismissed:{scene:'Incomplete'}}}),false)
  assert.equal(validMetaphorMetadata({...brief,request:{...brief.request,payload:{...brief.request.payload,count:2}}}),false)
  assert.equal(validMetaphorMetadata({...brief,request:{...brief.request,payload:{...brief.request.payload,exclusions:[null]}}}),false)
})
