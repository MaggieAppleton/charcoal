export const MODEL = 'gpt-image-2.6-sunburst'
export const SIZES = {Wide: '1536x1024', Square: '1024x1024', Tall: '1024x1536'}

/** @param {{prompt:string,inputs:{name:string}[],target:string|null,guideMode:'whole'|'mask'|'markup',rules:{title:string,prompt:string}[],styleName?:string}} request */
export function promptParts({prompt, inputs, target, guideMode, rules, styleName}) {
  /** @type {{kind:'img'|'you'|'sty',text:string,title?:string}[]} */
  const parts = []
  if (target && inputs[0]) {
    const instruction = {
      mask: `Make the requested change around the marked area and blend it naturally into the surrounding illustration. Image ${inputs.length + 1} is an unmasked copy of image 1. Use it to recover the forms, texture and detail beneath the mask. Keep the original framing and connect contours and textures across the edit. Preserve positions, proportions and transparency unless the requested edit calls for changing them. Treat the mask as a location guide and render the actual subject matter.`,
      markup: 'Sketch lines show where things go. The whole image may change.',
      whole: 'The whole image may change.',
    }[guideMode]
    parts.push({kind:'img', text: `Edit image 1. ${instruction}`})
  }
  if (prompt.trim()) parts.push({kind:'you', text: prompt.trim()})
  inputs.forEach((_, i) => {
    if (i || !target) parts.push({kind:'img', text: `Image ${i + 1} is attached.`})
  })
  for (const rule of rules) {
    if (rule.prompt.trim()) parts.push({kind:'sty',
      text:`Saved style default (apply only where consistent with the requested edit and preservation of the source; the current image instructions and assigned reference styles take precedence): ${rule.prompt.trim()}`,
      title:`${styleName}: ${rule.title}`})
  }
  return parts
}
