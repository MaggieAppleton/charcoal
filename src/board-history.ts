import type {BoardMark,Rect} from './board-geometry'
import type {BoardPatch} from './board-gestures'

type HistoryPatch = {
  markPoints?: BoardPatch['markPoints']
  positions?: Record<string,Rect|undefined>
  markChanges?: BoardPatch['markChanges']
}
type HistoryDirection = 'undo'|'redo'
type HistoryEntry = Record<HistoryDirection,HistoryPatch|(()=>void)> & {redoMarks?:()=>BoardMark[]}
const HISTORY_LIMIT=50

export function createBoardHistory() {
  let entries:Record<HistoryDirection,HistoryEntry[]>={undo:[],redo:[]}
  const listeners=new Set<()=>void>()
  function publish(next:typeof entries) {
    entries=next
    for(const notify of listeners)notify()
  }
  return {
    snapshot:()=>entries,
    redoMarks:()=>entries.redo.flatMap(entry=>entry.redoMarks?.()??[]),
    subscribe(notify:()=>void) {
      listeners.add(notify)
      return ()=>{listeners.delete(notify)}
    },
    record(entry:HistoryEntry,preserveRedo=false) {
      publish({undo:[...entries.undo.slice(1-HISTORY_LIMIT),entry],redo:preserveRedo?entries.redo:[]})
    },
    take(direction:HistoryDirection) {
      const entry=entries[direction].at(-1)
      if(!entry)return
      const opposite=direction==='undo'?'redo':'undo'
      publish({...entries,[direction]:entries[direction].slice(0,-1),[opposite]:[...entries[opposite],entry]})
      return entry[direction]
    },
    clear:()=>publish({undo:[],redo:[]}),
  }
}
