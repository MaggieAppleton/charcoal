import type {Asset, GuideMode, Settings, StudyMode, VariationAxis} from './model'
import {resolveImageMentions} from './image-mentions.js'
import {studyRequests} from './studies.js'

// These instructions travel in the run's frozen prompt. Existing servers and
// project exports therefore retain the exact direction without a schema migration.
export function studyDraft({prompt,settings,mode,inputs,guideMode,variation}:{
  prompt:string; settings:Settings; mode:StudyMode
  inputs:Asset[]; guideMode:GuideMode
  variation:VariationAxis
}) {
  // The rendered overlay is authoritative: erased notes must not survive as
  // hidden text instructions. Original editable guides remain in the run.
  const redlines=guideMode==='markup'
    ? 'The markup overlay contains editorial annotations, not artwork. Follow the visible arrows, outlines, and written notes as revision instructions. Remove all annotation marks and text from the finished illustration. Preserve the subject and unmentioned elements where possible.' : ''
  return studyRequests([resolveImageMentions(prompt,inputs),redlines].filter(Boolean).join('\n\n'),
    settings,mode,variation,guideMode==='mask')
}
