import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as pause} from 'node:timers/promises'
import {test} from 'node:test'
import {importAsset} from '../server/assets.mjs'
import {DEFAULT_BOARD,openBoards} from '../server/boards.mjs'
import {openStore} from '../server/store.mjs'

test('opening a multi-board workspace preserves legacy data and keeps background writes on their own boards',async()=>{
  const path=await mkdtemp(join(tmpdir(),'charcoal-boards-'))
  const image=await readFile(new URL('../public/samples/s1.png',import.meta.url))
  const settings={quality:'Low',complexity:'Low',size:'Wide',count:'1'}
  const legacy=openStore(path)
  await importAsset(legacy,{name:'Existing image',bytes:image},{id:'existing',normalized:true})
  legacy.set('workspace',{prompt:'Legacy prompt',referenceIds:['existing'],styleStore:{styles:[{name:'Legacy style'}]}})
  legacy.close()

  let finish
  const engine={generate:()=>new Promise((resolve)=>{finish=resolve})}
  const options={demo:true,provider:'fixture',engine}
  let boards=openBoards(path,options)
  try {
    assert.equal(boards.list().activeId,DEFAULT_BOARD)
    assert.throws(()=>boards.setArchived(DEFAULT_BOARD,true),{status:409})
    const first=boards.get(DEFAULT_BOARD)
    const {id}=boards.create('New work')
    const second=boards.get(id)
    assert.equal(first.demo,true)
    assert.equal(second.demo,false)
    assert.equal(second.store.get('workspace',null),null)
    assert.deepEqual(second.store.listAssets(),[])
    assert.equal(first.store.get('workspace').prompt,'Legacy prompt')

    first.jobs.submit({id:'first-run',prompt:'Generate on the first board',inputs:[],target:null,
      guideMode:'whole',guide:[],settings,rect:{x:0,y:0,width:176,height:99}})
    const backgroundUpload=importAsset(first.store,{name:'Background asset',bytes:image},{id:'async-import'})
    assert.equal(boards.setArchived(DEFAULT_BOARD,true).activeId,id)
    assert.throws(()=>boards.activate(DEFAULT_BOARD),{status:409})
    boards.rename(id,'Editorial')
    second.store.set('workspace',{prompt:'Second draft',referenceIds:[],styleStore:{styles:[{name:'Second style'}]}})
    await backgroundUpload
    finish({images:[image]})
    const deadline=Date.now()+3000
    while (first.jobs.busy&&Date.now()<deadline) await pause(10)
    assert.equal(first.jobs.get('first-run').status,'done')
    assert.equal(second.jobs.list().length,0)
    assert.equal(second.store.getAsset('existing'),undefined)
    assert.equal(second.store.getAsset('async-import'),undefined)
    assert.equal(first.store.getAsset('async-import').name,'Background asset')
    assert.throws(()=>boards.get('../charcoal'),{status:404})
    boards.close()
    boards=openBoards(path,options)
    assert.equal(boards.list().activeId,id)
    assert.equal(boards.list().boards.find((board)=>board.id===id).name,'Editorial')
    assert.equal(boards.list().boards.find((board)=>board.id===DEFAULT_BOARD).archived,true)
    assert.equal(boards.setArchived(DEFAULT_BOARD,false).activeId,id)
    assert.equal(boards.activate(DEFAULT_BOARD).activeId,DEFAULT_BOARD)
    assert.equal(boards.get(id).store.get('workspace').styleStore.styles[0].name,'Second style')
    const restored=boards.get(DEFAULT_BOARD)
    assert.equal(restored.store.get('workspace').styleStore.styles[0].name,'Legacy style')
    assert.deepEqual(restored.store.get('workspace').referenceIds,['existing'])
    assert.equal(restored.jobs.get('first-run').candidates.length,1)
  } finally {
    boards.close()
    await rm(path,{recursive:true,force:true})
  }
})

test('runtime provider updates apply to open boards without restarting',async()=>{
  const path=await mkdtemp(join(tmpdir(),'charcoal-runtime-'))
  const image=await readFile(new URL('../public/samples/s1.png',import.meta.url))
  const settings={quality:'Low',complexity:'Low',size:'Wide',count:'1'}
  const runtime={provider:'unconfigured',engine:null}
  const boards=openBoards(path,{demo:false,runtime})
  try {
    const board=boards.get(DEFAULT_BOARD)
    board.jobs.submit({id:'unconfigured-run',prompt:'Try before key',inputs:[],target:null,
      guideMode:'whole',guide:[],settings,rect:{x:0,y:0,width:176,height:99}})
    const firstDeadline=Date.now()+3000
    while (board.jobs.busy&&Date.now()<firstDeadline) await pause(10)
    assert.equal(board.jobs.get('unconfigured-run').status,'failed')

    runtime.provider='live'
    runtime.engine={generate:async()=>({images:[image]}),reviewer:{model:'gpt-5.4-mini',instruction:'test'}}
    board.jobs.submit({id:'configured-run',prompt:'Try after key',inputs:[],target:null,
      guideMode:'whole',guide:[],settings,rect:{x:0,y:0,width:176,height:99}})
    const secondDeadline=Date.now()+3000
    while (board.jobs.busy&&Date.now()<secondDeadline) await pause(10)
    assert.equal(board.jobs.get('configured-run').status,'done')
    assert.equal(board.jobs.get('configured-run').provider,'live')
    assert.equal(board.jobs.get('configured-run').candidates.length,1)
  } finally {
    boards.close()
    await rm(path,{recursive:true,force:true})
  }
})
