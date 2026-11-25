import {monochromeStudyInstruction} from './studies.js'

export const BATCH_PLAN_CONTRACT_VERSION = 4
export const MAX_BATCH_BRIEF_LENGTH = 20_000
export const MAX_RUN_PROMPT_LENGTH = 24_000

const individualRenderInstruction = 'Render one complete illustration. Use only the scene and treatment specified here. Include lettering or panels only where explicitly directed as part of the finished artwork.'

export const MAX_RENDER_BRIEF_LENGTH = MAX_RUN_PROMPT_LENGTH - individualRenderInstruction.length -
  monochromeStudyInstruction('composition').length - 4

/** @typedef {{alternatives:{renderPrompt:string}[]}} CompositionPlan */

/** @param {string} _batchBrief @param {CompositionPlan} plan @param {number} index @param {import('./model').VariationAxis} [_axis] @param {import('./model').StudyMode} [mode] */
export function renderComposition(_batchBrief,plan,index,_axis,mode='illustration') {
  const alternative=plan.alternatives[index]
  if (!alternative) throw new Error('The batch plan is missing this alternative.')
  const prompt=alternative.renderPrompt?.trim()
  if (!prompt) throw new Error('This plan cannot provide an individual render brief. Reload Charcoal and start a new batch.')
  return [prompt,monochromeStudyInstruction(mode),individualRenderInstruction].filter(Boolean).join('\n\n')
}
