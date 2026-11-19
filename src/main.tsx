import {createRoot} from 'react-dom/client'
import {BoardsApp} from './BoardsApp'
import {createBoardSession} from './board-session'
import {boardCatalogue,boardClient} from './client'
import './approved.css'
import './workspace.css'

const root = createRoot(document.getElementById('root')!)
async function start() {
  root.render(<main className="load-state" role="status">Opening workspace…</main>)
  try {
    const initial=await boardCatalogue.list()
    const client=boardClient(initial.activeId)
    const first=createBoardSession(client,await client.boot())
    root.render(<BoardsApp initial={initial} first={first}/>)
  } catch (error) {
    root.render(<main className="load-state"><p role="alert">{(error as Error).message}</p>
      <button className="btn" onClick={()=>void start()}>Try again</button></main>)
  }
}
void start()
