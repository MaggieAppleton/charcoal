import assert from 'node:assert/strict'
import test from 'node:test'
import {build} from 'esbuild'
import {createMetaphors} from '../server/metaphors.mjs'

// Bundle the actual canvas actions so this exercises their asynchronous history
// behavior alongside the server's request cache, without a live provider.
const compiled=await build({stdin:{contents:`
  export {metaphorActions} from './src/metaphor-actions.ts'
  export {createBoardHistory} from './src/board-history.ts'
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const {metaphorActions,createBoardHistory}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const options=['Mail slot','Measured drop','Lit shelf'].map(title=>({title,scene:`A simple ${title}.`,meaning:`${title} limits access.`,caveat:'One direction.'}))
const refined={...options[0],scene:'One envelope passes through a closed door.'}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

async function setup() {
  let workspace={annotations:[{id:'brief',kind:'note',points:[{x:0,y:0}],metaphor:{kind:'brief',title:'Brief',context:'Only share what is needed.'}}],positions:{}}
  const status={},history=createBoardHistory(),cache=new Map(),requests=[]
  let providerCalls=0,release,holdCache=false,holdAppend=false,loseResponse=false
  const append=[options[0],refined,...['Shared vice','Open toolbox','Neighbour’s ladder'].map(title=>({title,scene:`A ${title} beside an open door.`,meaning:title,caveat:''}))]
  const service=createMetaphors({get:(key,fallback)=>cache.get(key)??fallback,set:(key,value)=>cache.set(key,value)},
    {engine:{exploreMetaphors:async input=>{
      providerCalls++
      if(input.option||holdAppend)await new Promise(resolve=>{release=resolve})
      const excluded=new Set(input.exclusions?.map(option=>option.scene))
      return {options:input.option?[refined]:input.count===1?[append.find(option=>!excluded.has(option.scene))]:options}
    }}})
  const session={
    history,
    projectOpening:()=>false,
    setWorkspace:change=>{workspace=change(workspace)},
    snapshot:()=>({workspace,metaphorStatus:status,boot:{runs:[],assets:[]},submissions:[]}),
    setMetaphorStatus:(id,value)=>{status[id]=value},flush:async()=>{},
    client:{exploreMetaphors:async input=>{
      requests.push(input)
      const result=await service.explore(input)
      if(input.cacheOnly&&holdCache)await new Promise(resolve=>{release=resolve})
      if(loseResponse) {
        loseResponse=false
        throw new Error('Lost response')
      }
      return result
    }},
  }
  const actions=()=>metaphorActions(session,()=>undefined)
  const replay=direction=>{const action=history.take(direction);assert.equal(typeof action,'function');action()}
  await actions().explore('brief')
  assert.equal(status.brief?.error,undefined)
  const id=workspace.annotations.find(mark=>mark.metaphor.kind==='option').id
  return {
    actions,id,requests,mark:()=>workspace.annotations.find(mark=>mark.id===id),
    calls:()=>providerCalls,status:(target=id)=>status[target],release:()=>release(),
    holdCache:()=>{holdCache=true},holdAppend:()=>{holdAppend=true},loseResponse:()=>{loseResponse=true},
    marks:()=>workspace.annotations,change:session.setWorkspace,
    delete:ids=>history.record(actions().deleteMarks(ids)),
    undo:()=>replay('undo'),
    redo:()=>replay('redo'),
  }
}

for(const finishWhileHidden of [false,true]) {
  test(`refinement survives creation undo/redo with completion ${finishWhileHidden?'before':'after'} redo`,async()=>{
    const h=await setup()
    h.actions().edit(h.id,{feedback:'Simplify the handoff.'})
    const pending=h.actions().explore(h.id)
    await tick()
    const request=h.mark().metaphor.request
    h.undo()
    assert.equal(h.mark(),undefined)
    if(finishWhileHidden) {
      h.release();await pending
      assert.equal(h.mark(),undefined,'completion must not resurrect an undone card')
    }
    h.redo()
    assert.equal(h.mark().metaphor.feedback,'Simplify the handoff.')
    if(!finishWhileHidden) {
      assert.deepEqual(h.mark().metaphor.request,request)
      h.release();await pending
    }
    assert.equal(h.mark().metaphor.scene,refined.scene)
    assert.equal(h.mark().metaphor.lastRefinement,'Simplify the handoff.')
    assert.equal(h.calls(),2,'one exploration and one refinement provider call')
    assert.equal(h.status().busy,undefined)
  })
}

test('undoing a completed refinement reuses the paid result for identical feedback',async()=>{
  const h=await setup()
  h.actions().edit(h.id,{feedback:'Simplify the handoff.'})
  const pending=h.actions().explore(h.id)
  await tick();h.release();await pending
  const requestId=h.requests.at(-1).id
  h.undo()
  assert.equal(h.mark().metaphor.scene,options[0].scene)
  await h.actions().explore(h.id)
  assert.equal(h.mark().metaphor.scene,refined.scene)
  assert.equal(h.requests.at(-1).id,requestId)
  assert.equal(h.calls(),2,'the second refinement uses the server cache')
})


test('appending uses a frozen request and preserves concurrent deletion and unrelated marks',async()=>{
  const h=await setup()
  const before=h.marks().slice()
  h.holdAppend()
  const append=h.actions().explore('brief')
  await h.actions().explore('brief')
  await tick()
  h.delete([h.id])
  const note={id:'later',kind:'note',text:'Independent note',points:[{x:0,y:0}]}
  h.change(w=>({...w,annotations:[...w.annotations,note]}))
  h.loseResponse()
  h.release()
  await append
  assert.match(h.status('brief').error,/Lost response/)
  await h.actions().explore('brief')
  const [sent,recovered]=h.requests.slice(-2)
  assert.deepEqual({...sent,cacheOnly:true},recovered)
  assert.equal(sent.count,1)
  assert.deepEqual(sent.exclusions,options)
  assert.equal(h.calls(),2)
  const addition=h.marks().at(-1)
  assert.deepEqual(h.marks().slice(1,-1),[...before.slice(2),note])
  h.undo()
  h.undo()
  assert.deepEqual(h.marks().slice(1),[...before.slice(1),note])
  h.redo()
  h.redo()
  assert.deepEqual(h.marks().slice(1),[...before.slice(2),note,addition])
  assert.equal(h.calls(),2)
})

for(const restoreEarly of [false,true]) {
  test(`option deletion preserves late refinement ${restoreEarly?'and deletion redo':'while hidden'}`,async()=>{
    const h=await setup()
    const promptId=h.actions().useAsPrompt(h.id)
    h.actions().edit(h.id,{feedback:'Simplify the handoff.'})
    const pending=h.actions().explore(h.id)
    await tick()
    const points=h.mark().points
    h.delete([h.id])
    assert.ok(h.marks().some(mark=>mark.id===promptId))
    assert.equal(h.marks()[0].metaphor.dismissedOptions[h.id].scene,options[0].scene)
    if(restoreEarly)h.undo()
    h.release();await pending
    if(restoreEarly)h.redo()
    assert.equal(h.mark(),undefined)
    h.undo()
    assert.deepEqual(h.mark().points,points)
    assert.equal(h.mark().metaphor.promptId,promptId)
    assert.equal(h.mark().metaphor.scene,refined.scene)
    assert.deepEqual(h.mark().metaphor.history,[options[0]])
    assert.equal(h.mark().metaphor.feedback,'Simplify the handoff.')
    assert.equal(h.marks()[0].metaphor.dismissedOptions[h.id],undefined)
    assert.equal(h.calls(),2)
  })
}

test('redo restored cards leave the newer append request intact',async()=>{
  const h=await setup()
  h.undo()
  h.holdAppend()
  const pending=h.actions().explore('brief')
  await tick()
  h.redo()
  assert.equal(h.marks()[0].metaphor.request.payload.count,1)
  h.release();await pending
  assert.equal(h.marks().length,5)
  assert.equal(h.calls(),2)
})

for(const undoCreation of [true,false]) {
  test(`append excludes scenes available through ${undoCreation?'exploration':'append'} redo`,async()=>{
    const h=await setup()
    if(!undoCreation)await h.actions().explore('brief')
    const hidden=h.marks().slice(undoCreation?1:-1)
    h.undo()
    await h.actions().explore('brief')
    assert.equal(h.status('brief').error,undefined)
    for(const mark of hidden)assert.ok(h.requests.at(-1).exclusions.some(option=>option.scene===mark.metaphor.scene))
    h.redo()
    const scenes=h.marks().slice(1).map(mark=>mark.metaphor.scene)
    assert.equal(scenes.length,undoCreation?4:5)
    assert.equal(new Set(scenes).size,scenes.length)
  })
}

test('restoration skips a normalized scene already present in the same brief',async()=>{
  const h=await setup()
  const duplicate={...h.mark(),id:'later',metaphor:{...h.mark().metaphor,scene:'A SIMPLE mail slot!'}}
  h.undo()
  h.change(w=>({...w,annotations:[...w.annotations,duplicate]}))
  h.redo()
  assert.equal(h.mark(),undefined)
  assert.deepEqual(h.marks()[1],duplicate)
  assert.equal(h.marks().length,4)
})

async function refine(h) {
  h.actions().edit(h.id,{feedback:'Use one envelope.'})
  const pending=h.actions().explore(h.id)
  await tick()
  h.release()
  await pending
}

for(const when of ['after undo','during refinement']) {
  test('editing the option '+when+' detaches the frozen request',async()=>{
    const h=await setup()
    h.actions().edit(h.id,{feedback:'Use one envelope.'})
    const pending=h.actions().explore(h.id)
    await tick()
    if(when==='after undo'){h.release();await pending;h.undo()}
    const scene='A new scene with two doors.'
    const feedback='Focus on the second door.'
    h.actions().edit(h.id,{scene})
    h.actions().edit(h.id,{feedback})
    assert.equal(h.mark().metaphor.request,undefined)
    if(when==='during refinement'){h.release();await pending}
    assert.equal(h.mark().metaphor.scene,scene)
    assert.equal(h.calls(),2)
    // An explicit refinement of the new draft owns its own undo snapshot.
    const next=h.actions().explore(h.id)
    await tick();h.release();await next
    assert.equal(h.requests.at(-1).option.scene,scene)
    h.undo()
    assert.equal(h.mark().metaphor.scene,scene)
    assert.equal(h.mark().metaphor.feedback,feedback)
  })
}

test('append reserves the refined redo scene and replay checks other cards of its brief',async()=>{
  const h=await setup()
  await refine(h)
  h.undo()
  await h.actions().explore('brief')
  assert.ok(h.requests.at(-1).exclusions.some(option=>option.scene===refined.scene))
  const duplicate={...h.mark(),id:'collision',metaphor:{...h.mark().metaphor,scene:refined.scene.toUpperCase()}}
  h.change(w=>({...w,annotations:[...w.annotations,duplicate]}))
  h.redo()
  assert.equal(h.mark().metaphor.scene,options[0].scene)
  h.undo()
  h.change(w=>({...w,annotations:w.annotations.map(m=>m.id===duplicate.id?{...m,metaphor:{...m.metaphor,briefId:'other'}}:m)}))
  h.redo()
  assert.equal(h.mark().metaphor.scene,refined.scene)
  assert.equal(h.calls(),3)
})

test('a recovered cache response arriving after an edit leaves the new draft alone',async()=>{
  const h=await setup()
  await refine(h)
  h.undo()
  h.holdCache()
  const pending=h.actions().explore(h.id)
  await tick()
  h.actions().edit(h.id,{scene:'Two doors instead.',feedback:'Draw them side by side.'})
  h.release();await pending
  assert.equal(h.requests.at(-1).cacheOnly,true)
  h.redo()
  assert.equal(h.mark().metaphor.scene,'Two doors instead.')
  assert.equal(h.mark().metaphor.request,undefined)
  assert.equal(h.calls(),2)
})

test('cache-only refinement cannot introduce a normalized sibling duplicate',async()=>{
  const h=await setup()
  await refine(h)
  h.undo()
  const sibling={...h.mark(),id:'other-option',metaphor:{...h.mark().metaphor,scene:refined.scene.toUpperCase()}}
  h.change(w=>({...w,annotations:[...w.annotations,sibling]}))
  await h.actions().explore(h.id)
  assert.match(h.status().error,/repeated an option/)
  assert.equal(h.mark().metaphor.scene,options[0].scene)
  assert.equal(h.calls(),2)
})
