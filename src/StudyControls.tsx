import {useId} from 'react'
import type {StudyMode, VariationAxis} from './model'
import {VARIATION_LABELS} from './studies.js'
import {segmentKeys} from './segmented'
import './studies.css'

type Props = {
  mode: StudyMode
  onMode: (mode: StudyMode) => void
  count: number
  hasTarget: boolean
  regionalEdit: boolean
  variation: VariationAxis
  suggestedVariation: VariationAxis
  isSuggested: boolean
  onVariation: (axis: VariationAxis | undefined) => void
}

const modes: {value:StudyMode;label:string}[] = [{value:'illustration',label:'Illustration'}, {value:'composition',label:'B&W thumbnails'}]
const axes: VariationAxis[] = ['composition', 'colour', 'style', 'lighting', 'freeform']

export function StudyControls({mode, onMode, count, hasTarget, regionalEdit,
  variation, suggestedVariation, isSuggested, onVariation}: Props) {
  const id = useId()
  const monochrome = mode === 'composition'
  const displayedAxis = monochrome ? 'composition' : variation
  const needsTarget = mode !== 'illustration' && mode !== 'composition' && !hasTarget
  return <div className="study-controls">
    <div className="srow study-mode">
      <span className="lbl" id={`${id}-label`}>Study</span>
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={segmentKeys}>
        {modes.map(option => <button key={option.value} type="button" role="radio"
          aria-checked={option.value === 'composition' ? monochrome : !monochrome}
          tabIndex={(option.value === 'composition' ? monochrome : !monochrome) ? 0 : -1}
          onClick={() => onMode(option.value)}>{option.label}</button>)}
      </div>
    </div>
    {!regionalEdit && <div className="srow study-mode">
      <span className="lbl" id={`${id}-vary`}>Vary</span>
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-vary`} onKeyDown={segmentKeys}>
        {axes.map(axis => <button key={axis} type="button" role="radio"
          aria-checked={displayedAxis === axis} tabIndex={displayedAxis === axis ? 0 : -1}
          disabled={monochrome && axis !== 'composition'}
          onClick={() => { if (mode !== 'illustration' && !monochrome) onMode('illustration'); onVariation(axis) }}>
          {VARIATION_LABELS[axis]}</button>)}
      </div>
    </div>}
    {!regionalEdit && !monochrome && <div className="study-suggestion">
      <span>{isSuggested ? `Suggested: ${VARIATION_LABELS[suggestedVariation]}` : `Suggestion: ${VARIATION_LABELS[suggestedVariation]}`}</span>
      {!isSuggested && <button type="button" className="btn" onClick={() => onVariation(undefined)}>Use suggestion</button>}
    </div>}
    {needsTarget && <p className="study-hint" role="status">Open an image for editing to develop a {mode} study.</p>}
    {mode !== 'illustration' && mode !== 'composition' && hasTarget &&
      <p className="study-hint">Ask to keep the composition while exploring {mode === 'texture' ? 'mark-making and texture' : mode}. Style rules are paused.</p>}
    {monochrome && <p className="study-hint">Grayscale composition and value studies, guided by your references and style.</p>}
    {regionalEdit && count > 1 && <p className="study-hint">Variations explore the requested local edit.</p>}
    {!regionalEdit && (monochrome || count > 1) && <p className="study-hint">{displayedAxis === 'freeform' ? 'Different interpretations of your prompt and images.' : `Different ${displayedAxis} ideas drawn from your prompt and images.`}</p>}
  </div>
}
