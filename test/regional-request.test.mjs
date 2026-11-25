import assert from 'node:assert/strict'
import {test} from 'node:test'
import {decodeRgba,encodeRgba} from '../server/assets.mjs'
import {prepareRegional,unframe} from '../server/pixels.mjs'
import {openAIProviders} from '../server/providers.mjs'

const width=192,height=128
function pixels(colour) {
  const data=Buffer.alloc(width*height*4)
  for(let offset=0;offset<data.length;offset+=4)data.set(colour,offset)
  return data
}
function paintedArea() {
  const data=pixels([0,0,0,0])
  for(let y=0;y<height;y++)for(let x=0;x<60;x++)data[(y*width+x)*4+3]=255
  return data
}

test('masked request sends the untouched source and a separate transparent edit region',async t=>{
  const source=pixels([80,120,160,255])
  const original=await encodeRgba(source,width,height)
  const edit=await prepareRegional(original,await encodeRgba(paintedArea(),width,height),'mask',width,height)
  const raw=await encodeRgba(pixels([35,40,45,255]),width,height)
  let request
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    request={url,form:init.body}
    return Response.json({data:[{b64_json:raw.toString('base64')}]})
  })
  const provider=openAIProviders('test-only-credential')
  await provider.generate({guideMode:'mask',effectivePrompt:'Make the foreground darker and more monochrome.',
    settings:{quality:'Low',complexity:'Low',count:'1',size:'Wide'}},[edit.first],edit)

  assert.equal(request.url,'https://api.openai.com/v1/images/edits')
  assert.ok(request.form instanceof FormData)
  assert.equal(request.form.has('markup'),false)
  const image=request.form.getAll('image[]')[0]
  assert.equal(request.form.getAll('image[]').length,2,'masked edits include an unmasked original reference')
  const unmasked=await decodeRgba(Buffer.from(await request.form.getAll('image[]')[1].arrayBuffer()))
  assert.deepEqual(unmasked.data,source,'the extra reference preserves detail hidden by the mask')
  const mask=request.form.get('mask')
  assert.equal(image.type,'image/png')
  assert.equal(mask.type,'image/png')
  const sentSource=await decodeRgba(Buffer.from(await image.arrayBuffer()))
  const sentMask=await decodeRgba(Buffer.from(await mask.arrayBuffer()))
  assert.deepEqual(sentSource.data,source,'brush paint must never be flattened onto the source')
  assert.deepEqual([sentMask.width,sentMask.height],[sentSource.width,sentSource.height])
  const alphaAt=(x,y)=>sentMask.data[(y*width+x)*4+3]
  assert.equal(alphaAt(20,64),0)
  assert.equal(alphaAt(65,64),0,'make room for the transition beyond the brush')
  assert.equal(alphaAt(100,64),255,'leave distant content outside the provider mask')
})

test('regional compositing fades through the neighborhood and preserves distant transparent pixels',async()=>{
  const source=pixels([80,120,160,255])
  source.set([11,29,47,0],(width*height-1)*4)
  source.set([45,67,89,96],(width*height-2)*4)
  const original=await encodeRgba(source,width,height)
  const sourcePixels=(await decodeRgba(original)).data
  const brush=paintedArea()
  const edit=await prepareRegional(original,await encodeRgba(brush,width,height),'mask',width,height)
  const changed=pixels([35,40,45,255])
  changed.set([70,80,90,128],0)
  const raw=await encodeRgba(changed,width,height)
  const expected=(await decodeRgba(raw)).data
  const output=await unframe(raw,edit,true)
  const actual=(await decodeRgba(output.bytes)).data
  assert.deepEqual(actual.subarray(0,4),expected.subarray(0,4),'full edit at the image edge')
  const row=Array.from({length:width},(_,x)=>actual[(64*width+x)*4+2])
  assert.equal(row[60],45,'the edit crosses the painted boundary at full strength')
  assert.ok(row[67]>45&&row[67]<160,'the transition mixes source and generated colors')
  assert.ok(row.slice(59,90).every((value,i)=>value>=row[58+i]&&value-row[58+i]<25),
    'there is no abrupt color jump through the transition')
  assert.equal(row[90],160)
  assert.ok(output.exactPixels>0&&output.exactPixels<(width-60)*height)
  assert.deepEqual(actual.subarray(-width*4+90*4),sourcePixels.subarray(-width*4+90*4))
})

test('regional mask follows non-square framing without spilling into padding',async()=>{
  const original=await encodeRgba(pixels([80,120,160,255]),width,height)
  const guide=await encodeRgba(paintedArea(),width,height)
  const edit=await prepareRegional(original,guide,'mask',96,96)
  const {data}=await decodeRgba(edit.guide)
  const alphaAt=(x,y)=>data[(y*96+x)*4+3]
  assert.equal(alphaAt(32,16),0)
  assert.equal(alphaAt(32,15),255)
  assert.equal(alphaAt(12,79),0)
  assert.equal(alphaAt(12,80),255)
  assert.equal(alphaAt(60,48),255)
  await assert.rejects(unframe(original,edit,true),/different image size/)
  await assert.rejects(prepareRegional(original,await encodeRgba(pixels([0,0,0,0]),width,height),'mask',96,96),
    /edit area is empty/)
})

test('feather weights scale with the image and blend transparency without a dark fringe',async()=>{
  const sample=async(scale)=>{
    const w=width*scale,h=height*scale
    const source=await encodeRgba(Buffer.alloc(w*h*4),w,h)
    const guide=Buffer.alloc(w*h*4)
    for(let y=0;y<h;y++) for(let x=0;x<60*scale;x++) guide[(y*w+x)*4+3]=255
    const raw=await encodeRgba(Buffer.alloc(w*h*4,255),w,h)
    const edit=await prepareRegional(source,await encodeRgba(guide,w,h),'mask',w,h)
    const {data}=await decodeRgba((await unframe(raw,edit,true)).bytes)
    return data.subarray((64*scale*w+67*scale)*4,(64*scale*w+67*scale)*4+4)
  }
  const normal=await sample(1)
  const doubled=await sample(2)
  assert.deepEqual([...normal.subarray(0,3)],[255,255,255])
  assert.ok(normal[3]>0&&normal[3]<255)
  assert.ok(Math.abs(doubled[3]-normal[3])<=25)
})
