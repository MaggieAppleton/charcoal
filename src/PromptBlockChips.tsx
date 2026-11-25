import {Icon} from './Icon'
import type {PromptBlock} from './model'
import {promptBlockLabel} from './prompt-blocks'

const dragType = 'application/x-charcoal-prompt-block'

type Props = {
  blocks: PromptBlock[]
  onLocate: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (ids: string[]) => void
}

export function PromptBlockChips({blocks, onLocate, onRemove, onReorder}: Props) {
  if (!blocks.length) return null

  function move(id: string, to: number) {
    const ids = blocks.map(block => block.id)
    const from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    onReorder(ids)
  }

  return <ol className="prompt-block-chips" aria-label="Prompt blocks">
    {blocks.map(({id, text}, index) => {
      const label = promptBlockLabel(text)
      return <li key={id} className="prompt-block-chip"
        onDragOver={event => {
          if (event.dataTransfer.types.includes(dragType)) event.preventDefault()
        }}
        onDrop={event => {
          const source = event.dataTransfer.getData(dragType)
          if (!source) return
          event.preventDefault()
          move(source, index)
        }}>
        <button type="button" className="btn prompt-block-locate" aria-label={`Find ${label}`}
          data-tip={label} draggable={blocks.length > 1} onClick={() => onLocate(id)}
          aria-keyshortcuts={blocks.length > 1 ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
          onDragStart={event => {
            event.dataTransfer.setData(dragType, id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onKeyDown={event => {
            if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            move(id, index + (event.key === 'ArrowLeft' ? -1 : 1))
          }}>
          <Icon name="doc" /><span>{label}</span>
        </button>
        <button type="button" className="btn icon prompt-block-remove" aria-label={`Remove ${label} from prompt`}
          data-tip="Remove from prompt" onClick={() => onRemove(id)}><Icon name="x" /></button>
      </li>
    })}
  </ol>
}
