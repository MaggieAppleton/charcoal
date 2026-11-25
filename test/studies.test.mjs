import {test} from 'node:test'
import assert from 'node:assert/strict'
import {promptParts} from '../src/request.js'
import {renderComposition} from '../src/composition-plan.js'
import {studyRequests, suggestVariation, styleRulesForStudy} from '../src/studies.js'

test('saved styles are labelled as defaults subordinate to the requested edit',()=>{
  const prompt='Make the background a bit lighter. Keep everything else the same, including the dappled light and style.'
  const parts=promptParts({prompt,inputs:[{name:'Source.png'}],target:null,guideMode:'whole',rules:[{title:'Graphical',prompt:'No visible beams of sunlight. Use simple graphical shapes.'}],styleName:'Preset'})
  assert.equal(parts.find(p=>p.kind==='you').text,prompt)
  assert.match(parts.find(p=>p.kind==='sty').text,/only where consistent with the requested edit and preservation of the source/)
})

const settings = {quality:'High', complexity:'Low', size:'Tall', count:'4'}

test('masked batches vary the local request without inventing composition changes', () => {
  const prompt = 'Darken the dock beneath the boat.'
  const requests = studyRequests(prompt,settings,'illustration','composition',true)
  assert.equal(requests.length,4)
  for (const [index,request] of requests.entries()) {
    assert.ok(request.prompt.startsWith(prompt))
    assert.match(request.prompt,new RegExp(`local edit ${index+1} of 4`))
    assert.match(request.prompt,/Keep the scene aligned/)
    assert.doesNotMatch(request.prompt,/composition plan|viewpoint|different composition/)
    assert.deepEqual(request.settings,{...settings,count:'1'})
  }
})

test('composition studies retain reference character, grayscale values, and selected rendering quality', () => {
  const requests = studyRequests('A child listening to a shell.', settings, 'composition')
  assert.equal(requests.length, 4)
  assert.equal(new Set(requests.map(request => request.prompt)).size, 4)
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request.settings, {quality:'High', complexity:'High', size:'Tall', count:'1'})
    assert.match(request.prompt, /shared composition plan/)
    assert.match(request.prompt, /closely study all supplied reference images/)
    assert.match(request.prompt, /including midtones, soft transitions, and nuanced shadow masses/)
    assert.match(request.prompt, /With multiple references, combine the qualities the user asks for from each/)
    assert.match(request.prompt, /complete editorial illustration/)
    assert.doesNotMatch(request.prompt, /Use only solid black and white|no grey shading/)
    assert.match(request.prompt, /A child listening to a shell\./)
    assert.equal(request.label, `Composition ${index + 1}`)
  }
  assert.deepEqual(settings, {quality:'High', complexity:'Low', size:'Tall', count:'4'})
})

test('all variation dimensions ask for content-specific alternatives without fixed recipes', () => {
  for (const axis of ['composition','colour','style','lighting']) {
    const requests=studyRequests('An underwater library.', {...settings,count:'3'}, 'illustration',axis)
    for (const request of requests) {
      assert.match(request.prompt,/An underwater library/)
      assert.ok(request.prompt.includes(`shared ${axis} plan`))
      assert.doesNotMatch(request.prompt,/Develop 3|rendering alternative/)
      assert.doesNotMatch(request.prompt,/distant viewpoint|Look down from above|warm palette with a small cool|broad side lighting|transparent washes/)
    }
  }
})

test('single ordinary illustration preserves the user prompt and settings', () => {
  const single = {...settings, count:'1'}
  assert.deepEqual(studyRequests('  Original brief.  ', single, 'illustration'),
    [{prompt:'  Original brief.  ', settings:single, label:'Illustration'}])
})

test('ordinary multi-image generation varies composition without forcing black and white', () => {
  const requests = studyRequests('A colourful garden in watercolour.', settings, 'illustration')
  assert.equal(requests.length, 4)
  assert.equal(new Set(requests.map(request => request.prompt)).size, 4)
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request.settings, {...settings, count:'1'})
    assert.match(request.prompt, /shared composition plan/)
    assert.match(request.prompt, /Retain the requested colour palette, lighting character, visual style, and rendering finish/)
    assert.doesNotMatch(request.prompt, /only solid black and white|no grey shading/)
  }
})

test('variation axis selects distinct finished-image treatments and conditional source preservation', () => {
  for (const axis of ['colour', 'style', 'lighting']) {
    const requests = studyRequests('A garden.', settings, 'illustration', axis)
    assert.equal(requests.length, 4)
    assert.equal(new Set(requests.map(request => request.prompt)).size, 4)
    for (const request of requests) {
      assert.match(request.prompt, /If a source image is supplied, preserve its viewpoint, framing, positions/)
      assert.doesNotMatch(request.prompt, /Use image 1/)
      assert.deepEqual(request.settings, {...settings, count:'1'})
    }
  }
})

test('black-and-white mode keeps composition variation even after a different finished-image choice', () => {
  const [first] = studyRequests('A garden.', settings, 'composition', 'colour')
  assert.match(first.prompt, /black-and-white \(grayscale\)/)
  assert.match(first.prompt,/shared composition plan/)
  assert.equal(first.label, 'Composition 1')
})

test('variation suggestions default to composition and follow source edit keywords', () => {
  assert.equal(suggestVariation('Change the colour palette.', false), 'composition')
  assert.equal(suggestVariation('Move the subject to the left.', true), 'composition')
  assert.equal(suggestVariation('Try monochrome with less saturation.', true), 'colour')
  assert.equal(suggestVariation('Change the color of the sky.', true), 'colour')
  assert.equal(suggestVariation('Make the shadows longer.', true), 'lighting')
  assert.equal(suggestVariation('Give it dry brushwork and paper texture.', true), 'style')
  assert.equal(suggestVariation('A daylight scene.', true), 'composition')
})

test('development studies preserve composition and vary only their named dimension', () => {
  for (const mode of ['lighting', 'colour', 'texture']) {
    const requests = studyRequests('Develop this scene.', settings, mode)
    assert.equal(requests.length, 4)
    assert.equal(new Set(requests.map(request => request.prompt)).size, 4)
    for (const request of requests) {
      assert.match(request.prompt, /Use image 1 as the chosen study/)
      assert.match(request.prompt, /Preserve its subject identity, viewpoint, framing, positions, relative sizes, overlaps, and major shape boundaries/)
      assert.match(request.prompt, /do not invent a new scene or rearrange its elements/)
      assert.deepEqual(request.settings, {...settings, count:'1'})
    }
  }
  assert.match(studyRequests('Scene', settings, 'lighting')[0].prompt, /Change the lighting and shadow treatment only/)
  assert.match(studyRequests('Scene', settings, 'colour')[0].prompt, /Change the palette only/)
  assert.match(studyRequests('Scene', settings, 'texture')[0].prompt, /Change mark-making, texture, and edge treatment only/)
})

test('invalid study type or count cannot accidentally expand a paid batch', () => {
  assert.throws(() => studyRequests('Scene', settings, 'unknown'), /supported study type/)
  assert.throws(() => studyRequests('Scene', {...settings, count:'20'}, 'composition'), /one and four/)
  assert.throws(() => studyRequests('Scene', settings, 'illustration', 'unknown'), /supported variation type/)
})


test('composition style adaptation preserves originals, examples, and empty checks',()=>{
  const rules=[{id:'palette',title:'Warm washes',on:true,prompt:'Use red washes and soft edges.',check:'Red washes surround the figure.',ex:[{id:'reference',kind:'Like this'}]},
    {id:'silent',title:'Silent',on:true,prompt:'',check:'',ex:[]}]
  const before=structuredClone(rules)
  const adapted=styleRulesForStudy(rules,'composition')
  assert.deepEqual(rules,before)
  assert.match(adapted[0].prompt,/Translate colour requirements into grayscale values/)
  assert.match(adapted[0].check,/Preserve all other style requirements/)
  assert.doesNotMatch(adapted[0].prompt,/subordinate|Do not require.*polished final rendering/)
  assert.match(adapted[0].prompt,/Use red washes and soft edges/)
  assert.match(adapted[0].check,/Evaluate this criterion in that context/)
  assert.deepEqual(adapted[0].ex,rules[0].ex)
  assert.equal(adapted[1].prompt,'')
  assert.equal(adapted[1].check,'')
  assert.equal(styleRulesForStudy(rules,'illustration'),rules)
  for(const quality of ['Low','Medium','High']) assert.equal(studyRequests('A scene.',{...settings,quality},'composition')[0].settings.quality,quality)
})

test('effective grayscale batch prompt carries source roles, finished style and an assigned layout', () => {
  const prompt = 'A child listening to a shell. Use Image 1 for its brushwork and Image 2 for the shape of the shell.'
  const [study] = studyRequests(prompt, settings, 'composition')
  const plan = {alternatives: [{
    renderPrompt:prompt+' Render the child holding the shell against their right ear in grayscale, with connected hands and arms.',
    title:'A close profile', viewpoint:'Eye level', framing:'Close profile',
    layout:'The child holds the shell against their right ear.',
    values:'Side light, quiet midtone background', direction:'Reserve texture for the focal area.',
  }]}
  const rules = styleRulesForStudy([{title:'Brushwork',prompt:'Use fine ink hatching and a blue wash.',check:''}],'composition')
  const effective = promptParts({
    prompt:renderComposition(study.prompt,plan,0),
    inputs:[{name:'Ink reference'},{name:'Shell reference'}],
    target:null,guideMode:'whole',rules,styleName:'Ink and wash',
  }).map(part=>part.text).join(' ')
  assert.ok(effective.startsWith(prompt))
  assert.match(effective,/Image 1 is attached\. Image 2 is attached\./)
  assert.doesNotMatch(effective,/Ink reference|Shell reference/)
  assert.match(effective,/child holding the shell against their right ear/)
  assert.match(effective,/Use fine ink hatching and a blue wash\./)
  assert.match(effective,/Preserve all other style requirements/)
  assert.match(effective,/connected hands and arms/)
  assert.doesNotMatch(effective,/subordinate|Do not require.*polished final rendering|takes precedence over.*finished-rendering/)
})

test('a single grayscale study renders the requested scene without inventing a variation', () => {
  const [study] = studyRequests('A sailboat.', {...settings,count:'1'}, 'composition')
  assert.match(study.prompt,/complete editorial illustration/)
  assert.doesNotMatch(study.prompt,/shared composition plan|Choose a visibly different treatment/)
})


test('Freeform has no fixed artistic axis and keeps the ordinary single-image path',()=>{
  const prompt='Blend these three references; give me three different takes.'
  const requests=studyRequests(prompt,{...settings,count:'3'},'illustration','freeform')
  assert.equal(requests.length,3)
  for(const request of requests){
    assert.match(request.prompt,/shared freeform plan/)
    assert.doesNotMatch(request.prompt,/Change the palette only|Preserve the composition|Retain the requested colour palette/)
    assert.equal(request.settings.count,'1')
  }
  assert.equal(studyRequests('Draw a flower.',{...settings,count:'1'},'illustration','freeform')[0].prompt,'Draw a flower.')
})
