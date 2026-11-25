import {createBoardHistory} from './board-history'
import {boardClient} from './client'
import type {Boot,Workspace,Run} from './model'
import type {MetaphorStatus} from './MetaphorCard'
import {initialWorkspace} from './workspace'
import {keepAttachedMentions} from './inline-reference-draft.js'

export type Submission = Pick<Run,'id'|'label'|'rect'> & {status:'pending'|'failed';error?:string}

export function createBoardSession(client:ReturnType<typeof boardClient>,boot:Boot) {
  const history=createBoardHistory()
  const listeners = new Set<()=>void>()
  let current = {boot,workspace:initialWorkspace(boot),projectVersion:0,saveError:'',submissions:[] as Submission[],metaphorStatus:{} as Record<string,MetaphorStatus>}
  let queue:Promise<unknown> = Promise.resolve()
  let importsInFlight=0
  let openingProject=false
  const publish = (update:Partial<typeof current>)=>{
    current={...current,...update}
    if (update.boot) current.submissions=current.submissions.filter(job=>!current.boot.runs.some(run=>run.id===job.id))
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
  if (current.workspace!==boot.workspace) save(current.workspace)

  async function flush() {
    if (current.saveError) save(current.workspace)
    await queue
  }

  return {
    client,history,
    projectOpening:()=>openingProject,
    subscribe(notify:()=>void) {
      listeners.add(notify)
      return ()=>{listeners.delete(notify)}
    },
    snapshot:()=>current,
    setWorkspace(update:(previous:Workspace)=>Workspace) {
      const previous=current.workspace
      let workspace=update(previous)
      if (workspace===previous) return
      if (workspace.prompt!==previous.prompt || workspace.target!==previous.target || workspace.attachments!==previous.attachments) {
        const inputs=new Set(workspace.attachments)
        if (workspace.target) inputs.add(workspace.target)
        const prompt=keepAttachedMentions(workspace.prompt,inputs)
        if (prompt!==workspace.prompt) workspace={...workspace,prompt}
      }
      publish({workspace})
      save(workspace)
    },
    setBoot(update:(previous:Boot)=>Boot) {
      publish({boot:update(current.boot)})
    },
    setSubmissions(update:(previous:Submission[])=>Submission[]) {
      publish({submissions:update(current.submissions).filter(job=>!current.boot.runs.some(run=>run.id===job.id))})
    },
    setMetaphorStatus(id:string,status:MetaphorStatus) {
      publish({metaphorStatus:{...current.metaphorStatus,[id]:status}})
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
      if (current.submissions.some(job=>job.status==='pending')) throw new Error('Wait for the request to finish submitting before replacing this board.')
      if (Object.values(current.metaphorStatus).some(status=>status.busy)) throw new Error('Wait for metaphor requests to finish before replacing this board.')
      if (importsInFlight) throw new Error('Wait for image imports to finish before replacing this board.')
      if (openingProject) throw new Error('Wait for the project to finish opening.')
      openingProject=true
      try {
        await flush()
        const opened=await client.reOpen(file)
        const workspace=initialWorkspace(opened)
        history.clear()
        publish({boot:opened,workspace,projectVersion:current.projectVersion+1,saveError:'',submissions:[],metaphorStatus:{}})
        if (workspace!==opened.workspace) save(workspace)
      } finally {
        openingProject=false
      }
    },
    flush,
    clearSaveError:()=>publish({saveError:''}),
  }
}
export type BoardSession = ReturnType<typeof createBoardSession>
