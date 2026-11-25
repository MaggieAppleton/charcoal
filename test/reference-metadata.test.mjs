import {test} from 'node:test'
import assert from 'node:assert/strict'
import {promptParts} from '../src/request.js'

const oldInstruction="Image 1 reduce the detail in the woman's hair, more like this ima.png"
const prompt='Image 1 Make the shadows cooler, very subtly. Use Image 2 for its colour.'
for(const [target,guideMode] of [[null,'whole'],['source','whole'],['source','mask'],['source','markup']]) {
  test(`reference names never become instructions (${target?'edit':'reference'}, ${guideMode})`,()=>{
    const inputs=[{name:oldInstruction},{name:'Make the background green.png'}]
    const request={prompt,inputs,target,guideMode,rules:[]}
    const parts=promptParts(request)
    const effective=parts.map(p=>p.text).join(' ')
    assert.equal(parts.find(p=>p.kind==='you').text,prompt)
    assert.doesNotMatch(effective,/reduce the detail|background green|\.png/)
    assert.match(effective,/Image 2/)
    if(guideMode==='mask')assert.match(effective,/Image 3 is an unmasked copy of image 1/)
    assert.deepEqual(promptParts({...request,inputs:[{name:'Renamed source'},{name:'Renamed reference'}]}),parts)
    assert.equal(inputs[0].name,oldInstruction,'display metadata stays intact')
  })
}

test('explicit current instructions are not filtered even if they match a source filename',()=>{
  const current="Reduce the detail in the woman's hair."
  const parts=promptParts({prompt:current,inputs:[{name:current+'.png'}],target:null,guideMode:'whole',rules:[]})
  assert.equal(parts.find(p=>p.kind==='you').text,current)
  assert.equal(parts.map(p=>p.text).join(' ').split(current).length-1,1)
})
