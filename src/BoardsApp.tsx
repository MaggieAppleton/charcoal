import {useRef,useState} from 'react'
import {App} from './App'
import {createBoardSession,type BoardSession} from './board-session'
import {boardCatalogue,boardClient,type BoardList} from './client'

export function BoardsApp({initial,first}:{initial:BoardList;first:BoardSession}) {
  const [{catalogue,session},setCurrent] = useState({catalogue:initial,session:first})
  const boardId = catalogue.activeId
  const switched = useRef(false)
  const sessions = useRef(new Map([[initial.activeId,first]]))

  async function getSession(id:string) {
    let next=sessions.current.get(id)
    if (!next) {
      const client=boardClient(id)
      next=createBoardSession(client,await client.boot())
      sessions.current.set(id,next)
    }
    return next
  }

  async function select(id:string) {
    if (id===boardId) return
    await session.flush()
    const next=await getSession(id)
    const state=await boardCatalogue.activate(id)
    switched.current=true
    setCurrent({catalogue:state,session:next})
  }
  async function create(name:string) {
    const board=await boardCatalogue.create(name)
    setCurrent((previous)=>({ ...previous,catalogue:{...previous.catalogue,boards:[...previous.catalogue.boards,board]}}))
    await select(board.id)
  }
  async function rename(name:string) {
    const {boards}=await boardCatalogue.rename(boardId,name)
    setCurrent((previous)=>({...previous,catalogue:{...previous.catalogue,boards}}))
  }

  async function setArchived(id:string,archived:boolean) {
    if (archived&&id===boardId) {
      await session.flush()
      const fallback=catalogue.boards.find((board)=>board.id!==id&&!board.archived)
      if (fallback) await getSession(fallback.id)
    }
    const state=await boardCatalogue.setArchived(id,archived)
    const next=await getSession(state.activeId)
    if (state.activeId!==boardId) switched.current=true
    setCurrent({catalogue:state,session:next})
  }

  return <App key={boardId} session={session} catalogue={catalogue} focusWorkspace={switched.current}
    onBoardSelect={select} onBoardCreate={create} onBoardRename={rename} onBoardSetArchived={setArchived}/>
}
