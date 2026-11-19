import {boardClient} from './client'
import type {Boot,Workspace} from './model'
import {initialWorkspace} from './workspace'

export function createBoardSession(client:ReturnType<typeof boardClient>,boot:Boot) {
  const listeners = new Set<()=>void>()
  let current = {boot,workspace:initialWorkspace(boot),projectVersion:0,saveError:''}
  let queue:Promise<unknown> = Promise.resolve()
  let importsInFlight=0
  let openingProject=false
  const publish = (update:Partial<typeof current>)=>{
    current={...current,...update}
    for (const notify of listeners) notify()
  }
  const save = (workspace:Workspace)=>{
    const pending=queue.catch(()=>{}).then(()=>client.save(workspace))
    queue=pending
    void pending.then(()=>{
      if (pending===queue&&current.saveError) publish({saveError:''})
    },(error)=>{
      if (pending===queue) publish({saveError:`Could not save workspace. ${error instanceof Error?error.message:String(error)}`})
    })
  }
  if (!boot.workspace) save(current.workspace)

  async function flush() {
    if (current.saveError) save(current.workspace)
    await queue
  }

  return {
    client,
    subscribe(notify:()=>void) {
      listeners.add(notify)
      return ()=>{listeners.delete(notify)}
    },
    snapshot:()=>current,
    setWorkspace(update:(previous:Workspace)=>Workspace) {
      const workspace=update(current.workspace)
      if (workspace===current.workspace) return
      publish({workspace})
      save(workspace)
    },
    setBoot(update:(previous:Boot)=>Boot) {
      publish({boot:update(current.boot)})
    },
    async refresh() {
      const before=current.boot
      const update=await client.runs()
      if (before===current.boot) publish({boot:{...before,...update}})
    },
    async runAssetImport<T>(run:()=>Promise<T>):Promise<T> {
      if (openingProject) throw new Error('Wait for the project to finish opening.')
      importsInFlight++
      try {
        return await run()
      } finally {
        importsInFlight--
      }
    },
    async openProject(file:File) {
      if (importsInFlight) throw new Error('Wait for image imports to finish before replacing this board.')
      if (openingProject) throw new Error('Wait for the project to finish opening.')
      openingProject=true
      try {
        await flush()
        const opened=await client.reOpen(file)
        const workspace=initialWorkspace(opened)
        publish({boot:opened,workspace,projectVersion:current.projectVersion+1,saveError:''})
        if (!opened.workspace) save(workspace)
      } finally {
        openingProject=false
      }
    },
    flush,
    clearSaveError:()=>publish({saveError:''}),
  }
}
export type BoardSession = ReturnType<typeof createBoardSession>
