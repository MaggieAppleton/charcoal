import test from 'node:test'
import assert from 'node:assert/strict'
import {migrateInlineReferences,missingImageMentions,hasPromptText,recoverInlineReferences,keepAttachedMentions} from '../src/inline-reference-draft.js'

test('legacy directions become visible prose once, in target-first order',()=>{
  const draft={prompt:'A quiet landscape.',target:'tree',attachments:['hill','tree'],referenceDirections:{
    tree:{roles:['colour','lighting'],use:'Soft edges.',avoid:'The subject.'},
  }}
  const migrated=migrateInlineReferences(draft)
  assert.equal(migrated.prompt,'A quiet landscape.\n\n[[image:tree]] Use its colour, lighting. Soft edges. Avoid The subject.\n\n[[image:hill]]')
  assert.equal(migrateInlineReferences(migrated),migrated)
  assert.equal(draft.prompt,'A quiet landscape.')
})

test('existing mentions retain their prose and are not appended twice',()=>{
  const migrated=migrateInlineReferences({prompt:'Use [[image:tree]] for light.',attachments:['tree','hill']})
  assert.equal(migrated.prompt,'Use [[image:tree]] for light.\n\n[[image:hill]]')
})

test('a bare reference is not an instruction, and absent images remain identifiable',()=>{
  assert.equal(hasPromptText('  [[image:tree]] \n'),false)
  assert.equal(hasPromptText('[[image:tree]] with warmer light'),true)
  assert.deepEqual(missingImageMentions('Use [[image:tree]] and [[image:hill]].',['hill']),['tree'])
})


test('reload reattaches existing orphan references while preserving order and prose',()=>{
  const draft={prompt:'A [[image:sketch]] with [[image:base]] and [[image:sketch]].[[image:absent]]',
    attachments:[],target:'base',guideMode:'whole'}
  const assets=[{id:'base'},{id:'sketch'}]
  const recovered=recoverInlineReferences(draft,assets)
  assert.deepEqual(recovered.attachments,['sketch'])
  assert.equal(recovered.prompt,'A [[image:sketch]] with [[image:base]] and [[image:sketch]].')
  assert.equal(recovered.target,'base')
  assert.equal(recoverInlineReferences(recovered,assets),recovered)
})

test('input changes remove only the tokens for excluded assets',()=>{
  const prompt='[[image:old]] Replace the frame with [[image:new]]. [[image:old]]'
  assert.equal(keepAttachedMentions(prompt,new Set(['new'])),' Replace the frame with [[image:new]]. ')
})
