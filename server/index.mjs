import {createServer} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {basename, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DEFAULT_BOARD, openBoards} from './boards.mjs'
import {importAsset, readAsset, MAX_ASSET_BYTES} from './assets.mjs'
import {fixtureProviders, openAIProviders} from './providers.mjs'
import {validateRuns, validGuides, validPoint, validRect, validSettings, validStyleVersion} from './jobs.mjs'
import {fetchArticle, validArticleSource} from './article-ingestion.mjs'
import {validMetaphorMetadata} from './metaphors.mjs'

const host = '127.0.0.1'
const port = Number(process.env.CHARCOAL_PORT ?? 4317)
const demo = process.env.CHARCOAL_DEMO === '1'
const fixtureMode = process.env.CHARCOAL_FIXTURE === '1'
const envApiKey = fixtureMode ? '' : process.env.OPENAI_API_KEY?.trim() || ''
const root = fileURLToPath(new URL('../',import.meta.url))
const samples = new URL('../public/samples/',import.meta.url)
let sessionApiKey = ''
const runtime = {
  get provider() {
    return fixtureMode ? 'fixture' : (sessionApiKey || envApiKey) ? 'live' : 'unconfigured'
  },
  get sessionKey() {
    return Boolean(sessionApiKey)
  },
  engine: fixtureMode ? fixtureProviders(samples)
    : envApiKey ? openAIProviders(envApiKey,process.env.CHARCOAL_REVIEW_MODEL) : null,
  setSessionKey(key) {
    if (fixtureMode) throw bad('Fixture mode uses local sample responses.',409)
    sessionApiKey = key
    const activeKey = sessionApiKey || envApiKey
    this.engine = activeKey ? openAIProviders(activeKey,process.env.CHARCOAL_REVIEW_MODEL) : null
  },
}
const dataDir = resolve(process.env.CHARCOAL_DATA_DIR ?? (demo ? '.charcoal/demo' : '.charcoal/studio'))
const boards = openBoards(dataDir,{demo,runtime})
const defaultBoard = boards.get(DEFAULT_BOARD)

const names = {layout:'Layout sketch',swatches:'Dusk swatches',walkers:'Two walkers',leaves:'Leaf shapes',grain:'Dry ink grain',
  s1:'Stream crossing 1',s2:'Stream crossing 2',s3:'Stream crossing 3',s4:'Stream crossing 4',
  h1:'Hill path 1',h2:'Hill path 2',h3:'Hill path 3'}
if (demo && !defaultBoard.store.get('workspace',null)) {
  for (const [id,name] of Object.entries(names)) {
    if (!defaultBoard.store.getAsset(id)) {
      await importAsset(defaultBoard.store,{name,bytes:await readFile(new URL(`${id}.png`,samples))},{id,normalized:true})
    }
  }
}
// The guide PNG is retained in SQLite and project bundles for exact retries.
const publicRun = ({guidePng,dispatched,...run}) => run
const publicRuns = ({jobs}) => jobs.list().map(publicRun)
const scopedAsset = (asset,id) => {
  const scope = `?board=${encodeURIComponent(id)}`
  return {...asset,url:asset.url+scope,originalUrl:asset.originalUrl+scope}
}
const publicAssets = ({store,id}) => store.listAssets().map((asset)=>scopedAsset(asset,id))
const state = (board) => ({
  workspace:board.store.get('workspace',null),assets:publicAssets(board),runs:publicRuns(board),demo:board.demo,
  provider:runtime.provider,sessionKey:runtime.sessionKey,
  metaphorModel:runtime.engine?.metaphor??null,
})
const bad = (msg,status=400) => Object.assign(new Error(msg),{status})
const mime = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',png:'image/png'}
function respond(res,status,body,headers={}) {
  res.writeHead(status,{'X-Content-Type-Options':'nosniff','Cache-Control':'no-store',...headers})
  res.end(body)
}
function json(res,data,status=200) {
  respond(res,status,JSON.stringify(data),{'Content-Type':'application/json; charset=utf-8'})
}
async function receive(req,limit) {
  if (Number(req.headers['content-length']) > limit) throw bad('The file is too large.',413)
  const chunks = []
  let length = 0
  for await (const b of req) {
    length += b.length
    if (length > limit) throw bad('The file is too large.',413)
    chunks.push(b)
  }
  return Buffer.concat(chunks)
}
async function body(req,limit=8*1024*1024) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw bad('Expected JSON.',415)
  const bytes = await receive(req,limit)
  try { return JSON.parse(bytes.toString()) }
  catch { throw bad('This JSON file could not be read.') }
}

const record = (value) => value && typeof value === 'object' && !Array.isArray(value)

function validStyleStore(store, hasAsset) {
  if (!record(store) || !Array.isArray(store.styles) || !record(store.overrides) ||
      !Object.values(store.overrides).every((value) => typeof value === 'boolean')) return false
  const ids = new Set()
  for (const style of store.styles) {
    if (!validStyleVersion(style,hasAsset) || typeof style.id !== 'string' || ids.has(style.id) ||
        typeof style.dirty !== 'boolean' || !Array.isArray(style.history) ||
        !style.history.every((version) => validStyleVersion(version,hasAsset))) return false
    ids.add(style.id)
  }
  return store.activeId === null || ids.has(store.activeId)
}

function checkWorkspace(w,hasAsset) {
  const imageIds = (list) => Array.isArray(list) && new Set(list).size === list.length && list.every(hasAsset)
  const optionalImage = (id) => id === null || hasAsset(id)
  const isPrompt = (mark) => mark.kind === 'prompt' || (mark.kind === 'note' && mark.promptBlock === true)
  if (!record(w) || !imageIds(w.imageIds) || !imageIds(w.attachments) ||
      (w.deletedImageIds !== undefined && !imageIds(w.deletedImageIds)) ||
      (w.deletedRunIds !== undefined && (!Array.isArray(w.deletedRunIds) ||
        !w.deletedRunIds.every((id) => typeof id === 'string') || new Set(w.deletedRunIds).size !== w.deletedRunIds.length)) ||
      (w.referenceIds !== undefined && !imageIds(w.referenceIds)) ||
      (w.pinnedIds !== undefined && !imageIds(w.pinnedIds)) ||
      (w.metaphorDraft !== undefined && (!record(w.metaphorDraft) || typeof w.metaphorDraft.context !== 'string' ||
        w.metaphorDraft.context.length > 100000 ||
        (w.metaphorDraft.article !== undefined && !validArticleSource(w.metaphorDraft.article)) ||
        (w.metaphorDraft.briefId !== undefined &&
          (typeof w.metaphorDraft.briefId !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(w.metaphorDraft.briefId))))) ||
      (w.pendingSubmission !== undefined && (!record(w.pendingSubmission) ||
        typeof w.pendingSubmission.fingerprint !== 'string' ||
        !Array.isArray(w.pendingSubmission.ids) || w.pendingSubmission.ids.length<1 || w.pendingSubmission.ids.length>4 ||
        new Set(w.pendingSubmission.ids).size!==w.pendingSubmission.ids.length ||
        !w.pendingSubmission.ids.every(id=>typeof id==='string' && /^[a-z0-9][a-z0-9_-]{0,43}$/i.test(id)) ||
        (w.pendingSubmission.recoveryOnly !== undefined && typeof w.pendingSubmission.recoveryOnly !== 'boolean'))) ||
      (w.studyMode !== undefined && !['illustration','composition','lighting','colour','texture'].includes(w.studyMode)) ||
      (w.variationAxis !== undefined && !['composition','colour','style','lighting','freeform'].includes(w.variationAxis)) ||
      (w.studyDirections !== undefined && (!Array.isArray(w.studyDirections) || w.studyDirections.length > 4 ||
        !w.studyDirections.every(text => typeof text === 'string' && text.length <= 1200))) ||
      (w.referenceDirections !== undefined && (!record(w.referenceDirections) ||
        !Object.entries(w.referenceDirections).every(([id,direction]) => hasAsset(id) && record(direction) &&
          Array.isArray(direction.roles) && direction.roles.length <= 6 &&
          direction.roles.every(role => ['composition','colour','lighting','texture','style','subject'].includes(role)) &&
          ['use','avoid'].every(key => typeof direction[key] === 'string' && direction[key].length <= 1200)))) ||
      new Set(w.target === null ? w.attachments : [w.target,...w.attachments]).size > 8 ||
      !optionalImage(w.active) || !optionalImage(w.target) ||
      !validPoint(w.camera) || !Number.isFinite(w.camera.zoom) || w.camera.zoom <= 0 ||
      !['whole','mask','markup'].includes(w.guideMode) || !record(w.guides) ||
      !Object.values(w.guides).every(validGuides) || !record(w.positions) ||
      !Object.values(w.positions).every(validRect) || !validStyleStore(w.styleStore,hasAsset) ||
      !validSettings(w.settings) || typeof w.prompt !== 'string' || !Array.isArray(w.annotations) ||
      !w.annotations.every((mark) => record(mark) && typeof mark.id === 'string' &&
        ['pen','arrow','rect','ellipse','note','prompt'].includes(mark.kind) && Array.isArray(mark.points) &&
        mark.points.length > 0 && mark.points.every(validPoint) &&
        (mark.text === undefined || typeof mark.text === 'string') &&
        (mark.promptBlock === undefined || (mark.kind === 'note' && mark.promptBlock === true)) &&
        (mark.metaphor === undefined || (mark.kind === 'note' && !mark.promptBlock && validMetaphorMetadata(mark.metaphor) &&
          (mark.metaphor.article === undefined || validArticleSource(mark.metaphor.article)))) &&
        (!isPrompt(mark) || (mark.points.length === 1 && Boolean(mark.text?.trim()))))) {
    throw bad('This workspace is missing required data or references an unavailable image.')
  }
  const promptIds = w.annotations.filter(isPrompt).map(mark => mark.id)
  const prompts = new Set(promptIds)
  if (prompts.size !== promptIds.length ||
      (w.promptBlockIds !== undefined && (!Array.isArray(w.promptBlockIds) ||
        new Set(w.promptBlockIds).size !== w.promptBlockIds.length ||
        !w.promptBlockIds.every(id => prompts.has(id))))) {
    throw bad('This workspace has invalid prompt blocks.')
  }
}
async function api(req,res,url) {
  const path = url.pathname
  const method = req.method
  if (path === '/api/provider-key' && method === 'POST') {
    const input = await body(req,4096)
    const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
    if (!apiKey) throw bad('Enter an OpenAI API key.')
    runtime.setSessionKey(apiKey)
    return json(res,{provider:runtime.provider,sessionKey:runtime.sessionKey})
  }
  if (path === '/api/provider-key' && method === 'DELETE') {
    runtime.setSessionKey('')
    return json(res,{provider:runtime.provider,sessionKey:runtime.sessionKey})
  }
  if (path === '/api/boards' && method === 'GET') return json(res,boards.list())
  if (path === '/api/boards' && method === 'POST') {
    const input = await body(req)
    return json(res,boards.create(input?.name),201)
  }
  const boardRoute = /^\/api\/boards\/([a-z0-9-]+)$/i.exec(path)
  if (method === 'PATCH' && boardRoute) {
    const input = await body(req)
    if (typeof input?.archived === 'boolean') return json(res,boards.setArchived(boardRoute[1],input.archived))
    if (input?.active === true) return json(res,boards.activate(boardRoute[1]))
    return json(res,boards.rename(boardRoute[1],input?.name))
  }
  // An unscoped request always refers to the original board, even after switching.
  const board = boards.get(url.searchParams.get('board') ?? DEFAULT_BOARD)
  const {store,jobs} = board
  const assertReady = () => {
    if (board.opening) throw bad('Wait for the project to finish opening.',409)
  }
  if (method !== 'GET') assertReady()
  if (method === 'GET' && path === '/api/state') return json(res,state(board))
  if (method === 'GET' && path === '/api/runs') return json(res,{runs:publicRuns(board),assets:publicAssets(board)})
  if (method === 'PUT' && path === '/api/workspace') {
    const w = await body(req)
    assertReady()
    checkWorkspace(w,store.getAsset)
    store.set('workspace',w)
    return json(res,{ok:true})
  }
  if (method === 'POST' && path === '/api/assets') {
    board.uploads++
    try {
      const name = url.searchParams.get('name') ?? 'Untitled'
      const asset = await importAsset(store,{name,bytes:await receive(req,MAX_ASSET_BYTES)})
      return json(res,scopedAsset(asset,board.id),201)
    } finally {
      board.uploads--
    }
  }
  const asset = /^\/api\/assets\/([a-z0-9_-]+)(?:\/(original))?$/i.exec(path)
  if (method === 'PATCH' && asset && !asset[2]) {
    const input = await body(req,4096)
    assertReady()
    return json(res,scopedAsset(store.renameAsset(asset[1],input?.name),board.id))
  }
  if (method === 'GET' && asset) {
    const data = readAsset(store, asset[1], asset[2])
    if (!data) throw bad('Image not found.',404)
    return respond(res,200,data.bytes,{'Content-Type':data.mime, 'Cache-Control':'no-cache',
      ...(asset[2] ? {'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(data.name)}`} : {})})
  }
  if (method === 'POST' && path === '/api/article') {
    const input=await body(req,4096)
    return json(res,await fetchArticle(input?.url))
  }
  if (method === 'POST' && path === '/api/metaphors') {
    const draft=await body(req)
    assertReady()
    return json(res,await board.metaphors.explore(draft))
  }
  if (method === 'GET' && path === '/api/composition-plans') {
    assertReady()
    return json(res,{plan:board.plans.recover(url.searchParams.get('id'))})
  }
  if (method === 'POST' && path === '/api/composition-plans') {
    const draft=await body(req)
    assertReady()
    return json(res,await board.plans.create(draft))
  }
  if (method === 'POST' && path === '/api/runs') {
    const draft = await body(req,80*1024*1024)
    assertReady()
    return json(res,publicRun(jobs.submit(draft)),202)
  }
  const retry = /^\/api\/runs\/([a-z0-9_-]+)\/retry$/i.exec(path)
  if (method === 'POST' && retry) {
    const args = await body(req)
    assertReady()
    return json(res,publicRun(jobs.retry(retry[1],args.id,args.confirmed)),202)
  }
  const candidate = /^\/api\/runs\/([a-z0-9_-]+)\/candidates\/([a-z0-9_-]+)$/i.exec(path)
  if (method === 'PATCH' && candidate) {
    const action = await body(req)
    assertReady()
    jobs.updateCandidate(candidate[1],candidate[2],action)
    return json(res,{ok:true})
  }
  if (path === '/api/project' && method === 'GET') {
    return respond(res,200,JSON.stringify(store.exportProject()),{'Content-Type':'application/json',
      'Content-Disposition':'attachment; filename="charcoal-project.json"'})
  }
  if (path === '/api/project' && method === 'POST') {
    if (jobs.busy || board.plans.busy || board.metaphors.busy || board.uploads) throw bad('Wait for imports, generation and checks to finish before opening a project.',409)
    board.opening = true
    try {
      const bundle = await body(req,230*1024*1024)
      await store.importProject(bundle,{validate({workspace,runs,assets}) {
        const ids = new Set(assets.map((asset) => asset.id))
        if (workspace !== null) checkWorkspace(workspace,(id) => ids.has(id))
        validateRuns(runs,assets)
      }})
      jobs.recovery()
      return json(res,state(board))
    } finally {
      board.opening = false
    }
  }
  throw bad('Route not found.',404)
}

const server = createServer(async (req,res) => {
  try {
    const authority = req.headers.host
    if (![`${host}:${port}`,`localhost:${port}`].includes(authority)) throw bad('Open Charcoal on this Mac’s loopback address.',403)
    if (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== `http://${authority}`)) {
      throw bad('This request came from another origin.',403)
    }
    const url = new URL(req.url, `http://${authority}`)
    if (url.pathname.startsWith('/api/')) return await api(req,res,url)
    if (req.method !== 'GET') throw bad('Route not found.',404)
    const dist = resolve(root,'dist')
    const file = resolve(dist,`.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
    if (!file.startsWith(dist + sep)) throw bad('Route not found.',404)
    if (!(await stat(file).catch(()=>null))?.isFile()) throw bad('Page not found. Run npm run build before starting Charcoal.',404)
    return respond(res,200,await readFile(file),{
      'Content-Type':mime[basename(file).split('.').pop()] ?? 'application/octet-stream',
      'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'",
    })
  } catch (error) {
    if ((error.status ?? 500) >= 500) console.error(error.message)
    if (!res.headersSent && !res.destroyed) json(res,{error:error.status ? error.message : 'Charcoal could not complete this operation.'},error.status ?? 500)
  }
})
server.listen(port, host, () => console.log(`Charcoal on http://${host}:${port} (${demo ? 'sample board, ' : ''}${runtime.provider})`))
