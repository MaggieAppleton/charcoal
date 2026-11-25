import {
  type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState,
} from 'react'
import { Icon } from './Icon.js'
import { SIZES, type Asset, type GuideMode, type PromptBlock, type PromptPart, type Settings } from './model'
import { PromptBlockChips } from './PromptBlockChips'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import {parseImageMentions} from './image-mentions.js'
import { StudyControls } from './StudyControls'
import type { StudyMode, VariationAxis } from './model'
import { StyleEditor } from './StyleEditor'
import { activeStyle, type StyleStore } from './styles'
import {MetaphorComposer, type MetaphorComposerProps} from './MetaphorComposer'
import './composer.css'
import './attachments.css'

type ComposerProps = {
  metaphor?: MetaphorComposerProps
  onMode: (metaphor: boolean) => void
  studyMode: StudyMode
  onStudyMode: (mode: StudyMode) => void
  studyPreviews: {label: string; prompt: string}[]
  sending: boolean
  generating: boolean
  sent: boolean
  canSend: boolean
  missingReferences: boolean
  onStartFresh?: () => void
  variation: VariationAxis
  suggestedVariation: VariationAxis
  isSuggested: boolean
  pauseStyle: boolean
  onVariation: (axis: VariationAxis|undefined) => void
  assets: Asset[]
  attachments: string[]
  target: string | null
  guideMode: GuideMode
  prompt: string
  promptBlocks: PromptBlock[]
  onLocatePromptBlock: (id: string) => void
  onRemovePromptBlock: (id: string) => void
  onReorderPromptBlocks: (ids: string[]) => void
  settings: Settings
  styleStore: StyleStore
  parts: PromptPart[]
  checks: string[]
  notice?: string
  highlighted?: string | null
  onPrompt: (value: string) => void
  onClear: () => void
  onSettings: (value: Settings) => void
  onStyleStore: (value: StyleStore) => void
  onSend: () => void
  onRemove: (id: string) => void
  onHighlight: (id: string | null) => void
  onReorder: (ids: string[]) => void
  onImportExamples: (files: File[]) => Promise<Asset[]>
  onGuideMode: (mode: GuideMode) => void
}

const dims = {
  Wide: SIZES.Wide.replace('x', ' × '),
  Square: SIZES.Square.replace('x', ' × '),
  Tall: SIZES.Tall.replace('x', ' × '),
}
type Panel = 'style' | 'settings' | 'mode'

export function Composer(props: ComposerProps) {
  const {
    attachments, target, guideMode, assets, highlighted, prompt, settings, styleStore, onGuideMode,
    parts, checks, notice, onPrompt, onSettings, onStyleStore, onSend, onRemove,
    onHighlight, onReorder, onImportExamples,
  } = props
  const [panel, setPanel] = useState<Panel>()
  const [showPrompt, setShowPrompt] = useState(false)
  const composer = useRef<HTMLDivElement>(null)
  const input = useRef<PromptEditorHandle>(null)
  const previousAttachments = useRef(new Set(attachments))
  const popup = useRef<HTMLDivElement>(null)
  const modeTrigger = useRef<HTMLButtonElement>(null)
  const styleButton = useRef<HTMLButtonElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const style = activeStyle(styleStore)
  const checkList = checks.length < 2 ? checks[0] : checks.slice(0, -1).join(', ') + ' and ' + checks.at(-1)
  const isMetaphor = !!props.metaphor
  const trigger = panel === 'mode' ? modeTrigger : panel === 'style' ? styleButton : settingsButton

  useEffect(() => {
    if (isMetaphor) return
    const mentioned = new Set(parseImageMentions(prompt).flatMap(part => part.type==='image' ? [part.id] : []))
    const added = attachments.filter(id => !previousAttachments.current.has(id) && !mentioned.has(id))
    previousAttachments.current = new Set(attachments)
    if (added.length) input.current?.insertImages(added)
  }, [attachments, prompt, isMetaphor])

  useLayoutEffect(() => {
    const card = composer.current
    const frame = card?.closest<HTMLElement>('.frame')
    if (!card || !frame) return
    const place = () => {
      frame.style.setProperty('--composer-h', card.offsetHeight + 'px')
      const surface = popup.current
      const anchor = trigger.current
      if (!surface || !anchor) return
      const bounds = frame.getBoundingClientRect()
      const button = anchor.getBoundingClientRect()
      surface.style.maxWidth = Math.max(0, bounds.width - 24) + 'px'
      surface.style.maxHeight = Math.max(0, button.top - bounds.top - 20) + 'px'
      const left = Math.max(12, Math.min(button.left - bounds.left - 4, bounds.width - surface.offsetWidth - 12))
      surface.style.left = left + 'px'
      surface.style.bottom = (bounds.bottom - button.top + 8) + 'px'
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(card)
    watch.observe(frame)
    return () => watch.disconnect()
  }, [panel, trigger])

  useLayoutEffect(() => {
    if (!panel) return
    const surface = popup.current
    const anchor = trigger.current
    surface?.querySelector<HTMLElement>('button:not([tabindex="-1"]):not(:disabled)')?.focus({ preventScroll: true })

    function outside(event: globalThis.PointerEvent | FocusEvent) {
      const element = event.target
      if (!(element instanceof Element) || element.closest('.style-menu-positioner')) return
      if (!surface?.contains(element) && !anchor?.contains(element)) setPanel(undefined)
    }

    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const styleMenuOpen = surface?.querySelector('#styleSwitch[aria-expanded="true"]')
      if (styleMenuOpen) return
      event.preventDefault()
      event.stopPropagation()
      setPanel(undefined)
      anchor?.focus()
    }

    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [panel, trigger])

  function toggle(panelName: Panel) {
    setPanel(current => current === panelName ? undefined : panelName)
  }

  const modeButton = <button ref={modeTrigger} type="button" className="btn lead composer-mode-trigger" data-metaphor={isMetaphor||undefined}
    aria-label={`Composer mode, ${isMetaphor?'Metaphor':'Illustration'}`} aria-haspopup="dialog"
    aria-expanded={panel==='mode'} aria-controls={panel==='mode'?'composerMode':undefined}
    data-tip="Composer mode" onClick={()=>toggle('mode')}>
    <span>{isMetaphor?'Metaphor':'Illustration'}</span><Icon name="chevDown"/>
  </button>

  function chooseMode(metaphor: boolean) {
    props.onMode(metaphor)
    setPanel(undefined)
    requestAnimationFrame(()=>modeTrigger.current?.focus({preventScroll:true}))
  }

  return <>
    <div className="composer" id="composer" ref={composer}>
      {props.metaphor ? <MetaphorComposer {...props.metaphor} modeButton={modeButton}/> : <>
      {showPrompt && <div className="fullprompt" id="fullPrompt" aria-label="Full prompt" tabIndex={0}>
        <p>{parts.length ? parts.map((part, index) => <span key={index}>{index > 0 && ' '}
          <span className={part.kind} data-tip={part.title}>{part.text}</span>
        </span>) : <span className="muted">Your prompt</span>}</p>
        <p className="after">Sunburst 2.6 at {settings.quality.toLowerCase()} quality and {props.studyMode==='composition'?'high':settings.complexity.toLowerCase()} complexity, {dims[settings.size]}, {settings.count} {props.studyMode==='illustration'?(settings.count === '1' ? 'variation' : 'variations'):'separately directed studies'}.
          {checks.length > 0 && <><br />Each result is then checked for {checkList}.</>}
        </p>
        {props.studyPreviews.slice(1).map((study, index) => <div className="study-prompt-preview" key={index}>
          <b>{study.label}</b><p>{study.prompt}</p>
        </div>)}
      </div>}
      <PromptBlockChips blocks={props.promptBlocks} onLocate={props.onLocatePromptBlock}
        onRemove={id => { props.onRemovePromptBlock(id); input.current?.focus() }}
        onReorder={props.onReorderPromptBlocks} />
      <AttachmentTray assets={assets} attachments={attachments} target={target} guideMode={guideMode}
        onInsertReference={id => input.current?.insertImages([id])}
        highlighted={highlighted} onHighlight={onHighlight} onReorder={onReorder}
        onRemove={id => { onRemove(id); input.current?.focus() }} />
      {notice && <p className="limit composer-status" role="status">{notice}</p>}
      {props.missingReferences && <p className="composer-status missing-reference" role="status">Reattach the missing image, or delete its reference from the prompt.</p>}
      {props.onStartFresh && <div className="composer-status" role="status">
        A new batch generates every image again and may incur additional charges.
        <button type="button" className="btn" onClick={props.onStartFresh}>Start new batch</button>
      </div>}
      <PromptEditor ref={input} value={prompt} inputs={attachments.flatMap(id => assets.find(asset=>asset.id===id) ?? [])}
        onChange={onPrompt} onSubmit={onSend} canSubmit={props.canSend}
        placeholder={target
          ? guideMode === 'mask' ? 'What should change in the painted area?' : 'What should change in this image?'
          : attachments.length ? 'Describe how to use these images' : 'Describe an illustration'} />
      <div className="bar">
        {modeButton}
        <button ref={styleButton} type="button" className="btn lead" id="styleBtn" aria-haspopup="dialog"
          aria-expanded={panel === 'style'} aria-controls={panel === 'style' ? 'stylePop' : undefined}
          onClick={() => toggle('style')}>
          <Icon name="palette" /><span id="styleName">{props.pauseStyle ? 'Style paused' : style?.name || 'No style'}</span><Icon name="chevDown" />
        </button>
        <button ref={settingsButton} type="button" className="btn lead" id="setBtn" aria-haspopup="dialog"
          aria-expanded={panel === 'settings'} aria-controls={panel === 'settings' ? 'setPop' : undefined}
          onClick={() => toggle('settings')}>
          <Icon name="sliders" />{props.studyMode === 'illustration' ? 'Sunburst 2.6' : props.studyMode === 'composition' ? 'Composition studies' : `${props.studyMode[0].toUpperCase()}${props.studyMode.slice(1)} studies`} <span className="muted" id="setSummary">{props.studyMode === 'composition' ? 'B&W' : settings.quality}</span>
        </button>
        <button type="button" className="btn icon" id="fpBtn" aria-expanded={showPrompt}
          aria-controls={showPrompt ? 'fullPrompt' : undefined} aria-label="Full prompt" data-tip="Full prompt"
          onClick={() => setShowPrompt(!showPrompt)}><Icon name="doc" /></button>
        <span className="spacer" />
        {props.generating && <span className="composer-generation-indicator" role="status" aria-label="Generating images"/>}
        {(prompt.length > 0 || attachments.length > 0 || props.promptBlocks.length > 0) && <button type="button" className="btn icon"
          aria-label="Clear prompt" data-tip="Clear prompt" onClick={() => { props.onClear(); input.current?.focus() }}>
          <Icon name="eraser" />
        </button>}
        <button type="button" className="btn icon primary" id="send" aria-label={props.sent?'Submitted':'Send to Sunburst'}
          aria-busy={props.sending} data-sent={props.sent||undefined}
          disabled={!props.canSend} onClick={onSend}><Icon name={props.sent?'check':'arrowUp'} /></button>
      </div>
      </>}
    </div>
    {panel === 'mode' && <div ref={popup} className="pop composer-mode-menu" id="composerMode" role="dialog" aria-label="Composer mode">
      <button type="button" className="btn lead" aria-pressed={!isMetaphor} onClick={()=>chooseMode(false)}>
        <Icon name="brush"/>Illustration
      </button>
      <button type="button" className="btn lead" aria-pressed={isMetaphor} onClick={()=>chooseMode(true)}>
        <Icon name="doc"/>Metaphor
      </button>
    </div>}
    {!isMetaphor && panel === 'style' && <div ref={popup} className="pop style-pop" id="stylePop" role="dialog" aria-label="Style" style={{ width: 380 }}>
      <StyleEditor store={styleStore} assets={assets} attachments={attachments} onChange={onStyleStore} onImportExamples={onImportExamples} />
    </div>}
    {!isMetaphor && panel === 'settings' && <div ref={popup} className="pop some-settings" id="setPop" role="dialog" aria-label="Sunburst 2.6 settings" style={{ width: 316 }}>
      <StudyControls mode={props.studyMode} onMode={props.onStudyMode}
        count={Number(settings.count)} hasTarget={!!target} regionalEdit={!!target && guideMode==='mask'}
        variation={props.variation} suggestedVariation={props.suggestedVariation} isSuggested={props.isSuggested} onVariation={props.onVariation} />
      <Setting label="Quality" options={['Low', 'Medium', 'High']} value={settings.quality}
        onChange={quality => onSettings({ ...settings, quality })} />
      {props.studyMode!=='composition' && <Setting label="Complexity" options={['Low', 'Medium', 'High']} value={settings.complexity}
        onChange={complexity => onSettings({ ...settings, complexity })} />}
      <Setting label="Size" options={['Wide', 'Square', 'Tall']} value={settings.size} hints={dims}
        onChange={size => onSettings({ ...settings, size })} />
      <Setting label="Variations" options={['1', '2', '3', '4']} value={settings.count}
        onChange={count => onSettings({ ...settings, count })} />
      {target && <Setting label="Edit mode" options={['whole', 'mask', 'markup']} value={guideMode}
        labels={{ whole: 'Whole image', mask: 'Edit area', markup: 'Annotations' }} onChange={onGuideMode} />}
    </div>}
  </>
}

function Setting<Value extends string>({
  label, options, value, onChange, labels, hints,
}: {
  label: string
  options: Value[]
  value: Value
  onChange: (value: Value) => void
  labels?: Record<Value, string>
  hints?: Record<Value, string>
}) {
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = Math.max(0, options.indexOf(value))
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + steps[event.key] + options.length) % options.length
    onChange(options[next])
    event.currentTarget.querySelectorAll('button')[next]?.focus()
  }

  return <div className="srow">
    <span className="lbl">{label}</span>
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={navigate}>
      {options.map(option => <button key={option} type="button" role="radio" aria-checked={value === option}
        tabIndex={value === option ? 0 : -1} data-tip={hints?.[option]}
        onClick={() => onChange(option)}>{labels?.[option] ?? option}</button>)}
    </div>
  </div>
}

type TrayProps = Pick<ComposerProps, 'assets' | 'attachments' | 'target' | 'guideMode' | 'highlighted'
  | 'onHighlight' | 'onReorder' | 'onRemove'> & {onInsertReference:(id:string)=>void}

type Drag = { id: string; x: number; y: number; pointer: number; moved: boolean }
type Insertion = { id: string; after: boolean }

function AttachmentTray({
  assets, attachments, target, guideMode, highlighted, onHighlight, onReorder, onRemove,
  onInsertReference,
}: TrayProps) {
  const drag = useRef<Drag>(null)
  const insertion = useRef<Insertion>(null)
  const skipInsert = useRef(false)
  const [dragging, setDragging] = useState<string>()
  const [marker, setMarker] = useState<Insertion>()
  const [announcement, setAnnouncement] = useState('')

  function move(id: string, to: number) {
    const from = attachments.indexOf(id)
    const minimum = target ? 1 : 0
    if (id === target || from < 0 || to === from || to < minimum || to >= attachments.length) return
    const ordered = attachments.filter(item => item !== id)
    ordered.splice(to, 0, id)
    onReorder(ordered)
    const name = assets.find(asset => asset.id === id)?.name ?? 'Attachment'
    setAnnouncement(`${name} moved to position ${to + 1} of ${ordered.length}.`)
  }

  function track(event: PointerEvent<HTMLButtonElement>) {
    const interaction = drag.current
    if (!interaction || interaction.pointer !== event.pointerId) return
    if (!interaction.moved && Math.hypot(event.clientX - interaction.x, event.clientY - interaction.y) < 5) return
    if (!interaction.moved) {
      interaction.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(interaction.id)
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.att')
    const id = hit?.dataset.id
    const rect = hit?.getBoundingClientRect()
    const next = id && id !== interaction.id && rect
      ? { id, after: id === target || event.clientX >= (rect.left + rect.right) / 2 }
      : undefined
    if (next?.id === insertion.current?.id && next?.after === insertion.current?.after) return
    insertion.current = next ?? null
    setMarker(next)
  }

  function finish(event: PointerEvent<HTMLButtonElement>, drop: boolean) {
    const interaction = drag.current
    if (!interaction || event.pointerId !== interaction.pointer) return
    const next = insertion.current
    if (drop && interaction.moved) {
      skipInsert.current = true
      setTimeout(() => { skipInsert.current = false }, 0)
      if (next) {
        const rest = attachments.filter(id => id !== interaction.id)
        move(interaction.id, rest.indexOf(next.id) + Number(next.after))
      }
    }
    drag.current = null
    insertion.current = null
    setDragging(undefined)
    setMarker(undefined)
  }

  if (!attachments.length) return null
  return <div className="tray" id="tray" aria-label="Attached images">
    {attachments.map((id, index) => {
      const asset = assets.find(item => item.id === id)
      if (!asset) return null
      const isTarget = id === target
      const guideLabel = guideMode === 'markup' ? 'sketch' : 'edit area'
      const tip = `Image ${index + 1}: ${asset.name}${isTarget ? `, ${guideLabel}` : ''}`
      return <div className={`att${isTarget ? ' target' : ''}${id === highlighted ? ' hl' : ''}`} key={id} data-id={id}
        data-dragging={dragging === id ? '' : undefined}
        data-insertion={marker?.id === id ? marker.after ? 'after' : 'before' : undefined}
        onPointerEnter={() => onHighlight(id)} onPointerLeave={() => onHighlight(null)}
        onFocus={() => onHighlight(id)} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null)
        }}>
        <button type="button" className="thumb" data-tip={tip}
          aria-label={`Insert reference to ${asset.name}`} aria-description={tip}
          aria-keyshortcuts={isTarget ? undefined : 'Alt+ArrowLeft Alt+ArrowRight'}
          onClick={() => { if (!skipInsert.current) onInsertReference(id) }}
          onPointerDown={event => {
            if (!isTarget && event.button === 0 && event.isPrimary) {
              drag.current = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false }
            }
          }}
          onPointerMove={track} onPointerUp={event => finish(event, true)}
          onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}
          onKeyDown={event => {
            if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || isTarget) return
            event.preventDefault()
            move(id, index + (event.key === 'ArrowLeft' ? -1 : 1))
          }}>
          <img src={asset.url} alt="" draggable={false} />
          <span className="n" aria-hidden="true">{index + 1}</span>
          {isTarget && <span className="bm" data-guide={guideMode}><Icon name={guideMode === 'markup' ? 'pen' : 'brush'} /></span>}
        </button>
        <button type="button" className="x" aria-label={`Remove ${asset.name}`}
          data-tip={`Remove ${asset.name}`} onClick={() => onRemove(id)}><Icon name="x" /></button>
      </div>
    })}
    <span className="sr-only" role="status">{announcement}</span>
  </div>
}
