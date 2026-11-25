import {test} from 'node:test'
import assert from 'node:assert/strict'
import {imageMention,parseImageMentions,resolveImageMentions} from '../src/image-mentions.js'

test('image references preserve prose before, between and after repeated mentions',()=>{
  const value=`Use ${imageMention('one')} for colour, ${imageMention('two')} for shape, and ${imageMention('one')} for light.`
  assert.equal(resolveImageMentions(value,[{id:'one'},{id:'two'}]),'Use Image 1 for colour, Image 2 for shape, and Image 1 for light.')
  assert.equal(parseImageMentions(value).filter(part=>part.type==='image').length,3)
})
test('reordering inputs renumbers references without changing their identity',()=>{
  assert.equal(resolveImageMentions(`${imageMention('one')} then ${imageMention('two')}`,[{id:'two'},{id:'one'}]),'Image 2 then Image 1')
})
test('missing inputs stay visibly missing instead of referencing a different image',()=>{
  assert.equal(resolveImageMentions(`${imageMention('removed')} keep this`,[{id:'other'}]),'[Missing image reference] keep this')
})
test('ordinary prose, malformed markers and line breaks are retained literally',()=>{
  const text='Before\n[[image:bad id]] <b>text</b> after.'
  assert.equal(resolveImageMentions(text,[]),text)
  assert.deepEqual(parseImageMentions(''),[])
  assert.throws(()=>imageMention('bad]id'),/Invalid image reference/)
})
