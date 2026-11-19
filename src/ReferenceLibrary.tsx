import {useEffect,useId,useRef,useState,type DragEvent,type RefObject} from 'react'
import {Icon} from './Icon.js'
import type {Asset} from './model'
import './reference-library.css'

type ReferenceLibraryProps = {
  assets: Asset[]
  attachedIds: readonly string[]
  canvasIds?: readonly string[]
  onUpload: (files: File[]) => Promise<void>
  onAttach: (id: string) => void
  onPlace: (id: string) => void
  onRename: (id: string, trigger: HTMLButtonElement) => void
  onRemove: (id: string) => void
  onClose: () => void
  triggerRef?: RefObject<HTMLButtonElement | null>
}

export function ReferenceLibrary({
  assets, attachedIds, canvasIds = [], onUpload, onAttach, onPlace, onRename, onRemove, onClose, triggerRef,
}: ReferenceLibraryProps) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const uploading = useRef(false)
  const close = useRef(onClose)
  close.current = onClose
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const trigger = triggerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    uploadButton.current?.focus({preventScroll: true})

    function outside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return
      if (!panel.current?.contains(event.target) && !trigger?.contains(event.target)) close.current()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return
      event.preventDefault()
      event.stopPropagation()
      close.current()
      trigger?.focus({preventScroll: true})
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [triggerRef])

  async function upload(files: File[]) {
    if (uploading.current || !files.length) return
    uploading.current = true
    setBusy(true)
    setError('')
    try {
      await onUpload(files)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload references.')
    } finally {
      uploading.current = false
      setBusy(false)
    }
  }

  function dragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = uploading.current ? 'none' : 'copy'
    if (!uploading.current) setDropping(true)
  }

  function drop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    setDropping(false)
    void upload(Array.from(event.dataTransfer.files))
  }

  function remove(id: string, row: HTMLElement | null) {
    const next = row?.nextElementSibling ?? row?.previousElementSibling
    const focusTarget = next?.querySelector<HTMLButtonElement>('.reference-attach') ?? uploadButton.current
    focusTarget?.focus({preventScroll: true})
    onRemove(id)
  }

  return <section ref={panel} className="reference-library" role="dialog" aria-labelledby={titleId}
    data-dropping={dropping || undefined} onDragOver={dragOver}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropping(false)
    }} onDrop={drop}>
    <header className="reference-library-header">
      <h2 id={titleId}>References</h2>
      <button type="button" ref={uploadButton} className="btn lead" aria-disabled={busy} aria-busy={busy}
        onClick={() => { if (!uploading.current) picker.current?.click() }}>
        <Icon name="upload"/>{busy ? 'Uploading…' : 'Upload'}
      </button>
      <input ref={picker} type="file" aria-label="Upload reference images" multiple accept="image/*" hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          void upload(files)
        }}/>
    </header>
    {error && <p className="reference-library-error" role="alert">{error}</p>}
    <div className="reference-library-content">
      {assets.length ? <ul className="reference-list">
        {assets.map((asset) => {
          const attached = attachedIds.includes(asset.id)
          const placed = canvasIds.includes(asset.id)
          return <li key={asset.id} className="reference-row">
            <button type="button" className="reference-attach" aria-label={`Attach ${asset.name} to prompt`}
              aria-pressed={attached} data-tip={attached ? 'Detach from prompt' : 'Attach to prompt'}
              onClick={() => onAttach(asset.id)}>
              <img src={asset.url} alt="" loading="lazy" draggable={false}/>
              <span className="reference-name">{asset.name}</span>
              {attached && <Icon name="check"/>}
            </button>
            <button type="button" className="btn icon" aria-label={placed ? `${asset.name} is on the canvas` : `Place ${asset.name} on canvas`}
              data-tip={placed ? 'On the canvas' : 'Place on canvas'} aria-disabled={placed}
              onClick={() => { if (!placed) onPlace(asset.id) }}><Icon name="square"/></button>
            <button type="button" className="btn icon" aria-label={`Rename ${asset.name}`} data-tip="Rename image"
              onClick={(event) => onRename(asset.id, event.currentTarget)}><Icon name="pen"/></button>
            <button type="button" className="btn icon" aria-label={`Remove ${asset.name} from library`} data-tip="Remove from library"
              onClick={(event) => remove(asset.id, event.currentTarget.closest('li'))}><Icon name="x"/></button>
          </li>
        })}
      </ul> : <p className="reference-library-empty">Drop reference images here</p>}
    </div>
  </section>
}
