import {test} from 'node:test'
import assert from 'node:assert/strict'
import {renderComposition} from '../src/composition-plan.js'
import {openAIProviders} from '../server/providers.mjs'

const batchBrief = 'Image 1 give me a set of colour variation for this image. keep everything else the same, but try a set of subtle, subdued colour options. warm natural colours like browns, yellows, whites, light, with some very subtle and slight complementary shades in the background. use the colour and value to draw attention to the main spinning wheel and wool'
const shared = 'Keep the crop, values and wheel from image 1. Use image 2 strictly for edge treatment. Keep the sign reading “WOOL”.'
const treatments = [
  'Use a chestnut wheel and a muted celadon wall.',
  'Use honey oak and a trace of lavender in the wall.',
  'Use chalk white wool against pale blue-gray.',
  'Use olivewood and a muted rose background.',
]

for (const [axis,count] of [['composition',2],['colour',4],['lighting',3],['style',2],['freeform',4]]) {
  test(`the ${axis} plan sends only the selected image brief to the renderer`,async t=>{
    const plan={alternatives:treatments.slice(0,count).map((treatment,index)=>({
      title:`Internal label ${index}`,renderPrompt:`${shared} ${treatment}`,
      viewpoint:`Viewpoint ${index}`,framing:`Framing ${index}`,layout:`Layout ${index}`,
      values:`Values ${index}`,direction:`Direction ${index}`,approach:`Approach ${index}`,application:`Application ${index}`,
    }))}
    const renders=[]
    t.mock.method(globalThis,'fetch',async (url,{body})=>{
      if(url.endsWith('/responses')) {
        const planner=JSON.parse(body)
        assert.ok(planner.input[0].content[0].text.includes(batchBrief))
        assert.ok(planner.text.format.schema.properties.alternatives.items.required.includes('renderPrompt'))
        assert.match(planner.instructions,/explicit in-scene lettering/)
        if(axis==='freeform') assert.match(planner.instructions,/dimensions.*brief permits/)
        return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})
      }
      assert.match(url,/images\/edits$/)
      assert.equal(body.get('n'),'1')
      renders.push(body.get('prompt'))
      return Response.json({data:[{b64_json:Buffer.from('raster').toString('base64')}]})
    })
    const provider=openAIProviders('test-only')
    const refs=[Buffer.from('source'),Buffer.from('edge treatment reference')]
    const result=await provider.planCompositions({prompt:batchBrief,count,axis,contractVersion:2},refs)
    for(let index=0;index<count;index++){
      const effectivePrompt=renderComposition(batchBrief,result,index,axis)
      await provider.generate({effectivePrompt,settings:{quality:'High',complexity:'High',count:'1',size:'Wide'}},refs)
    }
    assert.equal(renders.length,count)
    for(const [index,render] of renders.entries()) {
      assert.ok(render.includes(shared))
      assert.ok(render.includes(treatments[index]))
      assert.match(render,/one complete illustration/)
      assert.doesNotMatch(render,/set of colour|Internal label|Direction \d|Approach \d/)
      for(const other of treatments.filter((_,i)=>i!==index)) assert.ok(!render.includes(other))
    }
  })
}

test('a legacy assignment cannot fall back to the batch brief',()=>{
  assert.throws(()=>renderComposition(batchBrief,{alternatives:[{title:'Old plan'}]},0),/start a new batch/i)
})
