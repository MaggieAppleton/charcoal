export const MODEL = 'gpt-image-2.6-sunburst'
export const SIZES = {Wide: '1536x1024', Square: '1024x1024', Tall: '1024x1536'}

/** @param {{prompt:string,inputs:{name:string}[],target:string|null,guideMode:'whole'|'mask'|'markup',rules:{title:string,prompt:string}[],styleName?:string}} request */
export function promptParts({prompt, inputs, target, guideMode, rules, styleName}) {
  /** @type {{kind:'img'|'you'|'sty',text:string,title?:string}[]} */
  const parts = []
  if (target && inputs[0]) {
    const instruction = {
      mask: 'Change only the painted area and keep every other pixel.',
      markup: 'Sketch lines show where things go. The whole image may change.',
      whole: 'The whole image may change.',
    }[guideMode]
    parts.push({kind:'img', text: `Edit image 1 (${inputs[0].name}). ${instruction}`})
  }
  if (prompt.trim()) parts.push({kind:'you', text: prompt.trim()})
  inputs.forEach((asset, i) => {
    if (i || !target) parts.push({kind:'img', text: `Image ${i + 1} is ${asset.name}.`})
  })
  for (const rule of rules) {
    if (rule.prompt.trim()) parts.push({kind:'sty', text:rule.prompt.trim(), title:`${styleName}: ${rule.title}`})
  }
  return parts
}
