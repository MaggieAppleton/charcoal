export const STUDY_LABELS = {
  illustration: 'Illustration', composition: 'Composition', lighting: 'Lighting', colour: 'Colour', texture: 'Texture',
}

export const VARIATION_LABELS = {composition:'Composition', colour:'Colour', style:'Style', lighting:'Lighting', freeform:'Freeform'}

/**
 * A visible starting suggestion, not a model inference or a generation request.
 * @param {string} prompt
 * @param {boolean} hasSource
 * @returns {import('./model').VariationAxis}
 */
export function suggestVariation(prompt, hasSource) {
  if (!hasSource) return 'composition'
  if (/\b(colou?rs?|palettes?|monochrom(?:e|atic)|hues?|saturat(?:ion|e|ed))\b/i.test(prompt)) return 'colour'
  if (/\b(lights?|lighting|relight|shadows?|backlit|backlighting)\b/i.test(prompt)) return 'lighting'
  if (/\b(textures?|brushwork|brushstrokes?|styles?|painterly|mark-making)\b/i.test(prompt)) return 'style'
  return 'composition'
}

const monochromeInstruction = 'Render in black-and-white (grayscale). Translate colours into tonal relationships while preserving the requested drawing style and finish.'

/** @param {import('./model').StudyMode} mode */
export function monochromeStudyInstruction(mode) {
  return mode==='composition' || mode==='lighting' ? monochromeInstruction : ''
}

const compositionInstruction = [
  'Render one complete editorial illustration in black-and-white (grayscale). Use the finish called for by the brief and references. Translate reference colours into grayscale tonal relationships, including midtones, soft transitions, and nuanced shadow masses where appropriate.',
  'Before drawing, closely study all supplied reference images and the user’s instructions about each one. Use style references to guide the actual drawing: shape language, proportions, character design, line and brushwork, texture, edge treatment, spatial rhythm, and lighting. With multiple references, combine the qualities the user asks for from each. Carry the visual language into the requested scene and use subject and composition references as directed.',
  'When using an image for style, carry over how it is drawn and lit. Leave out its distinctive scenery, subjects, and decorative borders unless the brief or another assigned reference role calls for them. Where the brief and any assigned composition leave room, invent an appropriate setting and staging that make the action legible.',
  'Keep the narrative action legible. Use a consistent viewpoint and perspective, keep hands connected to plausible arm poses, and show clear contact with the objects they handle. Place overlaps and crops so those relationships read. Use placement, scale, negative space, and value grouping to make the illustration readable at thumbnail size while retaining the reference’s characteristic rendering and detail.',
  'Render one coherent image without captions, borders, or a thumbnail sheet.',
].join('\n')

const grayscaleStyleContext = 'Translate colour requirements into grayscale values. Preserve all other style requirements, including mark-making, texture, edges, proportions, and finish.'

/** Keep the saved style intact; adapt only this study’s request and checks.
 * @param {import('./styles').Rule[]} rules
 * @param {import('./model').StudyMode} mode
 */
export function styleRulesForStudy(rules, mode) {
  if (mode !== 'composition') return rules
  return rules.map(rule=>({...rule,
    prompt:rule.prompt.trim()?`${grayscaleStyleContext}\nStyle direction: ${rule.prompt}`:'',
    check:rule.check.trim()?`${grayscaleStyleContext}\nEvaluate this criterion in that context: ${rule.check}`:'',
  }))
}

const preservationInstruction = 'Use image 1 as the chosen study. Preserve its subject identity, viewpoint, framing, positions, relative sizes, overlaps, and major shape boundaries. Develop the existing composition; do not invent a new scene or rearrange its elements.'
const developmentInstruction = {
  lighting: 'Make a monochrome lighting and value study. Change the lighting and shadow treatment only; keep the existing surface treatment simple. Do not introduce colour or decorative texture.',
  colour: 'Make a colour study. Change the palette only; preserve the existing light-dark hierarchy, lighting direction, detail placement, and surface treatment.',
  texture: 'Make a surface-treatment study. Change mark-making, texture, and edge treatment only; preserve the existing palette, lighting, light-dark hierarchy, and focus.',
}

const variationInstruction = {
  freeform: 'Follow the user’s requested changes. Preserve all unmentioned qualities of an existing source, especially its style, medium, detail, shape language and lighting. For new images or blends, follow the reference roles and their visual language. Distinguish results only within the scope the brief permits; do not impose a single variation dimension or invent a replacement medium.',
  composition: 'Explore a distinctly different composition for the same subject and narrative idea. Retain the requested colour palette, lighting character, visual style, and rendering finish. Choose changes to viewpoint, framing, relative scale, overlap, or negative space that serve this particular brief. Make one complete illustration, not a thumbnail sheet.',
  colour: 'Explore a different colour palette only. Preserve the composition, subject, light-dark hierarchy, lighting direction, detail placement, and visual style specified in the brief. If a source image is supplied, preserve its viewpoint, framing, positions, relative sizes, overlaps, and major shape boundaries.',
  style: 'Explore a different visual style and mark-making treatment only. Preserve the composition, subject, colour palette, lighting, and focal hierarchy specified in the brief. If a source image is supplied, preserve its viewpoint, framing, positions, relative sizes, overlaps, and major shape boundaries.',
  lighting: 'Explore a different lighting and shadow treatment only. Preserve the composition, subject, colour palette, visual style, and detail placement specified in the brief. If a source image is supplied, preserve its viewpoint, framing, positions, relative sizes, overlaps, and major shape boundaries.',
}

/** @param {import('./model').StudyMode} mode @param {import('./model').VariationAxis} variation
 * @returns {import('./model').VariationAxis}
 */
export function studyAxis(mode, variation) {
  return mode === 'illustration' ? variation : mode === 'texture' ? 'style' : mode
}

/**
 * Every multi-image request receives independent, inspectable variation briefs.
 * @param {string} prompt
 * @param {import('./model').Settings} settings
 * @param {import('./model').StudyMode} mode
 * @param {import('./model').VariationAxis} [variation]
 * @param {boolean} [regionalEdit]
 * @returns {{prompt:string,settings:import('./model').Settings,label:string}[]}
 */
export function studyRequests(prompt, settings, mode, variation = 'composition', regionalEdit = false) {
  if (!Object.hasOwn(STUDY_LABELS, mode)) throw new Error('Choose a supported study type.')
  if (!Object.hasOwn(VARIATION_LABELS, variation)) throw new Error('Choose a supported variation type.')
  const count = Number(settings.count)
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Choose between one and four studies.')
  if (mode === 'illustration' && count === 1) return [{prompt, settings: {...settings}, label: STUDY_LABELS[mode]}]
  if (regionalEdit) {
    const direction = mode === 'illustration' || mode === 'composition' ? '' : developmentInstruction[mode]
    return Array.from({length: count}, (_, index) => ({
      label: `Edit ${index + 1}`,
      prompt: [prompt.trim(), direction, count > 1
        ? `Render local edit ${index + 1} of ${count}. Explore alternatives in how to apply the requested change. Keep the scene aligned with the original.` : '']
        .filter(Boolean).join('\n\n'),
      settings: {...settings, count: '1'},
    }))
  }
  return Array.from({length: count}, (_, index) => {
    const composition = mode === 'composition'
    const axis = studyAxis(mode, variation)
    const instructions = composition ? compositionInstruction
      : mode === 'illustration' ? variationInstruction[variation]
      : `${preservationInstruction}\n${developmentInstruction[mode]}`
    const label = `${VARIATION_LABELS[axis]} ${index + 1}`
    const kind = mode === 'illustration' ? 'variation' : 'study'
    const direction = count>1 ? axis==='composition'
      ? 'A shared composition plan supplies the specific layout for this image.'
      : `A shared ${axis} plan supplies the specific treatment for this image. Render only the assigned treatment as one complete image.`
      : composition ? 'Compose the requested scene using the complete brief and supplied references.'
      : 'Choose a visibly different treatment based on the complete brief and supplied images.'
    return {
      label,
      prompt: `${prompt.trim()}\n\n${VARIATION_LABELS[axis]} ${kind} ${index + 1}\n${instructions}\n${direction}\nRespect explicit subject constraints; apply reference guidance where consistent with this ${kind}.`,
      settings: {...settings, count: '1', ...(composition ? {complexity: 'High'} : {})},
    }
  })
}
