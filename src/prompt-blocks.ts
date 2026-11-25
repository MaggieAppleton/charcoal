import type {BoardMark} from './board-geometry'
import type {Boot,PromptBlock,Workspace} from './model'

export function linkedPromptBlocks(ids: string[] | undefined, marks: BoardMark[]): PromptBlock[] {
  if (!ids?.length) return []
  const text = new Map(marks.filter(mark => mark.kind === 'prompt').map(mark => [mark.id, mark.text?.trim()]))
  return ids.flatMap(id => {
    const value = text.get(id)
    return value ? [{id, text: value}] : []
  })
}

export function promptBlockLabel(text: string) {
  const excerpt = text.replace(/\s+/g, ' ').trim()
  return excerpt.length > 52 ? excerpt.slice(0, 51) + '…' : excerpt
}


// Store prompt text as a note with metadata so a running server can save it.
export function encodePromptBlocks(workspace: Workspace): Workspace {
  if (!workspace.annotations.some(mark => mark.kind === 'prompt')) return workspace
  return {...workspace, annotations: workspace.annotations.map(mark =>
    mark.kind === 'prompt' ? {...mark, kind: 'note', promptBlock: true} : mark
  )}
}

export function decodePromptBlocks(boot: Boot): Boot {
  const workspace = boot.workspace
  if (!workspace?.annotations.some(mark => mark.kind === 'note' && mark.promptBlock)) return boot
  return {...boot, workspace: {...workspace, annotations: workspace.annotations.map(mark => {
    if (mark.kind !== 'note' || !mark.promptBlock) return mark
    const {promptBlock, ...annotation} = mark
    return {...annotation, kind: 'prompt'}
  })}}
}
