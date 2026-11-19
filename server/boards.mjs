import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {createJobs} from './jobs.mjs'
import {openStore} from './store.mjs'

export const DEFAULT_BOARD = 'default'
const registryKey = 'boards'
const initialRegistry = () => ({activeId:DEFAULT_BOARD,boards:[{id:DEFAULT_BOARD,name:'Board 1'}]})

export function openBoards(dataDir,{demo,provider,engine}) {
  // The original SQLite file and images directory remain the first board.
  const legacy = openStore(dataDir)
  const contexts = new Map()
  const read = () => legacy.get(registryKey,initialRegistry())
  const persist = (state) => { legacy.set(registryKey,state); return state }
  const find = (state,id) => {
    const board = state.boards.find((item) => item.id === id)
    if (!board) throw Object.assign(new Error('Board not found.'),{status:404})
    return board
  }
  const boardName = (name) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed || trimmed.length > 80) {
      throw Object.assign(new Error('Enter a board name of 1 to 80 characters.'),{status:400})
    }
    return trimmed
  }

  return {
    list: read,
    get(id) {
      find(read(),id)
      if (!contexts.has(id)) {
        const store = id === DEFAULT_BOARD ? legacy : openStore(join(dataDir,'boards',id))
        contexts.set(id,{id,store,jobs:createJobs(store,provider,engine),
          demo:demo && id === DEFAULT_BOARD,opening:false,uploads:0})
      }
      return contexts.get(id)
    },
    create(name) {
      const state = read()
      const board = {id:randomUUID(),name:boardName(name)}
      persist({...state,boards:[...state.boards,board]})
      return board
    },
    activate(id) {
      const state = read()
      if (find(state,id).archived) {
        throw Object.assign(new Error('Restore this board before opening it.'),{status:409})
      }
      return persist({...state,activeId:id})
    },
    rename(id,name) {
      const state = read()
      find(state,id).name = boardName(name)
      return persist(state)
    },
    setArchived(id,archived) {
      const state = read()
      const board = find(state,id)
      if (Boolean(board.archived) === archived) return state
      if (archived && state.activeId === id) {
        const fallback = state.boards.find((item) => item.id !== id && !item.archived)
        if (!fallback) throw Object.assign(new Error('Keep at least one active board.'),{status:409})
        state.activeId = fallback.id
      }
      if (archived) board.archived = true
      else delete board.archived
      return persist(state)
    },
    close() {
      for (const context of contexts.values()) {
        if (context.store !== legacy) context.store.close()
      }
      legacy.close()
    },
  }
}
