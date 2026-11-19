import { Menu } from '@base-ui/react/menu'
import { Popover } from '@base-ui/react/popover'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent,
} from 'react'
import { Icon } from './Icon.js'
import type { Asset } from './model'
import { exampleKinds, MAX_RULE_EXAMPLES, type Example, type ExampleKind, type Rule } from './styles'
import './style-examples.css'

type Area = NonNullable<Example['area']>
type Point = [number, number]

const FULL: Area = [0, 0, 1, 1]
const NEW_AREA: Area = [.25, .25, .5, .5]
const MIN_SIZE = .04
const KEY_STEP = .02
const THUMB = { width: 88, height: 50 }
const PREVIEW = { width: 256, height: 180 }
const ARROWS: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
function round(area: Area): Area {
  const [x, y, width, height] = area.map(value => Math.round(value * 1000))
  return [x / 1000, y / 1000, Math.min(width, 1000 - x) / 1000, Math.min(height, 1000 - y) / 1000]
}
const percent = (value: number) => `${value * 100}%`

/* Composer closes the whole style panel from a document capture listener on Escape.
   A window capture listener runs first, so Escape closes only this layer. */
function useEscapeFirst(open: boolean, close: () => void) {
  const latest = useRef(close)
  useLayoutEffect(() => { latest.current = close })
  useEffect(() => {
    if (!open) return
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [open])
}

type ExampleListProps = {
  rule: Rule
  assets: Asset[]
  attachments: string[]
  onChange: (rule: Rule) => void
  onImportExamples: (files: File[]) => Promise<Asset[]>
}

export function ExampleList({ rule, assets, attachments, onChange, onImportExamples }: ExampleListProps) {
  const [openId, setOpenId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [importError, setImportError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const latest = useRef({ rule, onChange })
  const mounted = useRef(false)
  const available = MAX_RULE_EXAMPLES - rule.ex.length
  const selected = attachments.filter(id => !rule.ex.some(example => example.id === id))
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => { latest.current = { rule, onChange } }, [rule, onChange])
  useEscapeFirst(adding, () => setAdding(false))

  function add(ids: string[]) {
    if (!mounted.current) return
    const { rule: current, onChange: change } = latest.current
    const fresh = [...new Set(ids)].filter(id => !current.ex.some(item => item.id === id))
    const additions: Example[] = fresh.slice(0, MAX_RULE_EXAMPLES - current.ex.length).map(id => ({ id, kind: 'Like this' }))
    if (additions.length) change({ ...current, ex: [...current.ex, ...additions] })
  }

  function edit(example: Example) {
    onChange({ ...rule, ex: rule.ex.map(item => item.id === example.id ? example : item) })
  }

  function remove(id: string) {
    const index = rule.ex.findIndex(item => item.id === id)
    onChange({ ...rule, ex: rule.ex.filter(item => item.id !== id) })
    setOpenId(undefined)
    requestAnimationFrame(() => {
      const triggers = list.current?.querySelectorAll<HTMLElement>('.sx-trigger')
      const next = triggers?.[Math.min(index, triggers.length - 1)] ?? list.current?.querySelector<HTMLElement>('.addex')
      next?.focus()
    })
  }

  return <div>
    <span className="field-l">Examples</span>
    <div className="exs" ref={list}>
      {rule.ex.map(example => <ExampleItem key={example.id} example={example}
        asset={assets.find(asset => asset.id === example.id)} open={openId === example.id}
        onOpenChange={open => setOpenId(open ? example.id : undefined)}
        onChange={edit} onRemove={() => remove(example.id)} />)}
      <Menu.Root modal={false} open={adding} onOpenChange={setAdding}>
        <Menu.Trigger className="addex" aria-label="Add example" data-tip="Add example" disabled={available <= 0}>
          <Icon name="plus" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="style-menu-positioner" align="start" sideOffset={4} collisionPadding={12}>
            <Menu.Popup className="menu style-menu">
              <Menu.Item className="menu-item" disabled={!selected.length} onClick={() => {
                setImportError('')
                add(selected)
              }}><Icon name="plus" /><span>Add selected art</span></Menu.Item>
              <Menu.Item className="menu-item" onClick={() => file.current?.click()}>
                <Icon name="upload" /><span>Upload images…</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={async event => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (!files.length || available <= 0) return
        setImportError('')
        try {
          const imported = await onImportExamples(files.slice(0, available))
          add(imported.map(asset => asset.id))
          if (!imported.length && mounted.current) setImportError('Could not import examples.')
        } catch (error) {
          if (mounted.current) setImportError(error instanceof Error ? error.message : 'Could not import examples.')
        }
      }} />
    </div>
    {importError && <p role="alert" className="limit">{importError}</p>}
    {available <= 0 && <p className="limit">{MAX_RULE_EXAMPLES} examples at most.</p>}
  </div>
}

function ExampleItem({ example, asset, open, onOpenChange, onChange, onRemove }: {
  example: Example
  asset?: Asset
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (example: Example) => void
  onRemove: () => void
}) {
  const name = asset?.name ?? 'Unavailable image'
  useEscapeFirst(open, () => onOpenChange(false))
  return <div className="ex sx-item">
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className="sx-trigger" aria-label={`${example.kind}: ${name}`}
        onKeyDown={event => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            onRemove()
          }
        }}>
        <ExampleImage example={example} asset={asset} />
        <span className="sx-caption"><b>{example.kind}</b>{name}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="style-menu-positioner" side="bottom" align="start"
          sideOffset={6} collisionPadding={12}>
          <Popover.Popup className="sx-pop" aria-label={name}>
            <RadioGroup<ExampleKind> className="seg sx-kinds" aria-label="Example type" value={example.kind}
              onValueChange={kind => onChange({
                ...example, kind, area: kind === 'Focal area' ? example.area ?? NEW_AREA : undefined,
              })}>
              {exampleKinds.map(kind => <Radio.Root key={kind} value={kind} render={<button />} nativeButton>{kind}</Radio.Root>)}
            </RadioGroup>
            <FocalArea asset={asset} area={example.kind === 'Focal area' ? example.area ?? FULL : undefined}
              onChange={area => onChange({ ...example, area })} />
            <button type="button" className="btn lead sx-remove-action" onClick={onRemove}>
              <Icon name="trash" />Remove
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
    <button type="button" className="sx-remove" tabIndex={-1} aria-label={`Remove ${name}`}
      data-tip="Remove example" onClick={onRemove}><Icon name="x" /></button>
  </div>
}

/* Read-only example, used in version history. */
export function ExampleFigure({ example, asset }: { example: Example; asset?: Asset }) {
  return <figure className="ex">
    <ExampleImage example={example} asset={asset} />
    <figcaption><b>{example.kind}</b>{asset?.name ?? 'Unavailable image'}</figcaption>
  </figure>
}

function ExampleImage({ example, asset }: { example: Example; asset?: Asset }) {
  const area = example.kind === 'Focal area' ? example.area ?? FULL : undefined
  return <span className="sx-image">
    {asset && <img src={asset.url} alt="" draggable={false} />}
    {asset && area && <span className="sx-shade" style={coverBox(asset, area)} />}
  </span>
}

/* Places a focal area on a thumbnail whose image uses object-fit: cover. */
function coverBox(asset: Asset, area: Area): CSSProperties | undefined {
  if (!asset.width || !asset.height) return
  const scale = Math.max(THUMB.width / asset.width, THUMB.height / asset.height)
  const width = asset.width * scale
  const height = asset.height * scale
  const left = (THUMB.width - width) / 2
  const top = (THUMB.height - height) / 2
  return {
    left: percent((left + area[0] * width) / THUMB.width),
    top: percent((top + area[1] * height) / THUMB.height),
    width: percent(area[2] * width / THUMB.width),
    height: percent(area[3] * height / THUMB.height),
  }
}

function fromCorners(a: Point, b: Point): Area {
  const width = Math.max(MIN_SIZE, Math.abs(a[0] - b[0]))
  const height = Math.max(MIN_SIZE, Math.abs(a[1] - b[1]))
  return round([
    clamp(Math.min(a[0], b[0]), 0, 1 - width),
    clamp(Math.min(a[1], b[1]), 0, 1 - height),
    width, height,
  ])
}

type Drag =
  | { mode: 'move'; start: Point; area: Area }
  | { mode: 'size'; anchor: Point; drawing: boolean }

function FocalArea({ asset, area, onChange }: { asset?: Asset; area?: Area; onChange: (area: Area) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag>(null)
  const [draft, setDraft] = useState<Area>()
  const hint = useId()
  const ratio = asset && asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9
  const width = Math.min(PREVIEW.width, PREVIEW.height * ratio)
  const size = { width, height: width / ratio }
  const shown = draft ?? area

  if (!asset) return <div className="sx-crop sx-missing" style={size}>Unavailable image</div>

  function point(event: PointerEvent): Point {
    const bounds = box.current!.getBoundingClientRect()
    return [clamp((event.clientX - bounds.left) / bounds.width), clamp((event.clientY - bounds.top) / bounds.height)]
  }

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!area || event.button !== 0) return
    const target = event.target as Element
    const corner = target.closest<HTMLElement>('[data-corner]')?.dataset.corner
    const [x, y, w, h] = area
    if (corner) drag.current = { mode: 'size', drawing: false, anchor: [corner.includes('w') ? x + w : x, corner.includes('n') ? y + h : y] }
    else if (target.closest('.sx-area')) drag.current = { mode: 'move', start: point(event), area }
    else drag.current = { mode: 'size', drawing: true, anchor: point(event) }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    handle.current?.focus({ preventScroll: true })
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    const p = point(event)
    if (current.mode === 'move') {
      const [x, y, w, h] = current.area
      setDraft(round([clamp(x + p[0] - current.start[0], 0, 1 - w), clamp(y + p[1] - current.start[1], 0, 1 - h), w, h]))
    } else if (!current.drawing || Math.hypot(p[0] - current.anchor[0], p[1] - current.anchor[1]) > .02) {
      current.drawing = false
      setDraft(fromCorners(current.anchor, p))
    }
  }

  function up() {
    if (!drag.current) return
    drag.current = null
    if (draft) onChange(draft)
    setDraft(undefined)
  }

  function key(event: KeyboardEvent) {
    const arrow = ARROWS[event.key]
    if (!arrow || !area) return
    event.preventDefault()
    let [x, y, w, h] = area
    if (event.shiftKey) {
      w = clamp(w + arrow[0] * KEY_STEP, MIN_SIZE, 1 - x)
      h = clamp(h + arrow[1] * KEY_STEP, MIN_SIZE, 1 - y)
    } else {
      x = clamp(x + arrow[0] * KEY_STEP, 0, 1 - w)
      y = clamp(y + arrow[1] * KEY_STEP, 0, 1 - h)
    }
    onChange(round([x, y, w, h]))
  }

  const style = shown && { left: percent(shown[0]), top: percent(shown[1]), width: percent(shown[2]), height: percent(shown[3]) }
  const whole = (value: number) => Math.round(value * 100)
  return <div ref={box} className={`sx-crop${shown ? ' editing' : ''}`} style={size}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={() => { drag.current = null; setDraft(undefined) }}>
    <div className="sx-crop-image">
      <img src={asset.url} alt={shown ? '' : asset.name} draggable={false} />
      {style && <span className="sx-shade" style={style} />}
    </div>
    {style && shown && <>
      <button type="button" ref={handle} className="sx-area" style={style} onKeyDown={key}
        aria-describedby={hint}
        aria-label={`Focal area, ${whole(shown[0])}% from left, ${whole(shown[1])}% from top, ${whole(shown[2])}% wide, ${whole(shown[3])}% tall`}>
        {['nw', 'ne', 'sw', 'se'].map(corner => <span key={corner} data-corner={corner} aria-hidden="true" />)}
      </button>
      <span id={hint} hidden>Drag on the image to draw an area. Arrow keys move it; Shift with arrow keys resizes it.</span>
    </>}
  </div>
}
