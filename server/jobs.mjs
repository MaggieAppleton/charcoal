import {readAsset, importAsset} from './assets.mjs'
import {isFocalArea, prepareRegional, unframe} from './pixels.mjs'
import {promptParts, SIZES} from '../src/request.js'

const levels = ['Low','Medium','High']
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,43}$/
const bad = (msg,status=400) => Object.assign(new Error(msg),{status})
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const runId = (id) => typeof id === 'string' && idPattern.test(id)
const bounded = (n) => Number.isFinite(n) && Math.abs(n) < 1e7
const modes = ['whole','mask','markup']
const exampleKinds = ['Like this','Not this','Focal area']
const states = ['pending','done','failed','uncertain']
const judgments = ['pass','warn','fail']
const providers = ['live','fixture','unconfigured']
const checkRules = (run) => (run.style?.rules ?? []).filter((rule) => rule.check.trim())
const incompleteCheck = (rule) => ({id:rule.id,title:rule.title,status:'warn',obs:'The reviewer did not return a judgment.'})

export function validSettings(settings) {
  return object(settings) && levels.includes(settings.quality) && levels.includes(settings.complexity) &&
    Object.hasOwn(SIZES,settings.size) && ['1','2','3','4'].includes(settings.count)
}

export function validPoint(point) {
  return object(point) && bounded(point.x) && bounded(point.y)
}

export function validRect(rect) {
  return validPoint(rect) && bounded(rect.width) && bounded(rect.height) && rect.width > 0 && rect.height > 0
}

export function validGuides(guide) {
  return Array.isArray(guide) && guide.length <= 3000 && guide.every((stroke) =>
    object(stroke) && ['area','sketch'].includes(stroke.layer) && Number.isFinite(stroke.size) &&
    stroke.size >= 0 && stroke.size <= 10_000 && [undefined,true,false].includes(stroke.erase) &&
    [undefined,true,false].includes(stroke.fill) && Array.isArray(stroke.pts) && stroke.pts.length > 0 &&
    stroke.pts.every((point) => Array.isArray(point) && point.length === 2 && point.every(bounded)))
}

export function validStyleVersion(style, hasAsset) {
  if (!object(style) || typeof style.name !== 'string' || !Number.isSafeInteger(style.version) ||
      style.version < 0 || !Array.isArray(style.rules) || style.rules.length > 50) return false
  const ids = new Set()
  return style.rules.every((rule) => {
    if (!object(rule) || typeof rule.id !== 'string' || !rule.id || rule.id === 'pixel' || ids.has(rule.id) ||
        typeof rule.on !== 'boolean' || !['title','prompt','check'].every((key) => typeof rule[key] === 'string') ||
        !Array.isArray(rule.ex) || rule.ex.length > 16 ||
        !rule.ex.every((ex) => object(ex) && hasAsset(ex.id) && exampleKinds.includes(ex.kind) &&
          (ex.area === undefined || isFocalArea(ex.area)))) return false
    ids.add(rule.id)
    return true
  })
}

function normalizedRun(body, getAsset, frozenPrompt) {
  if (!object(body)) throw bad('This run request is missing required data.')
  const {id, inputs, target = null, parent, guideMode, guide, guidePng, settings, rect} = body
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!runId(id) || !prompt || prompt.length > 24000) throw bad('Enter a prompt of up to 24,000 characters.')
  if (!Array.isArray(inputs) || inputs.length > 8 || new Set(inputs).size !== inputs.length) {
    throw bad('Choose at most eight distinct inputs.')
  }
  const assets = inputs.map(getAsset)
  if (assets.some((asset) => !asset) || (target !== null && target !== inputs[0]) ||
      (parent != null && !getAsset(parent))) {
    throw bad('An input is missing or the edit target is not image 1.')
  }
  if (!validSettings(settings)) throw bad('Choose a supported quality, complexity, size and variation count.')
  if (!validRect(rect)) throw bad('The result location is invalid.')
  if (!modes.includes(guideMode) || (guideMode !== 'whole' && (target === null || typeof guidePng !== 'string' || !guidePng))) {
    throw bad('Open the edit area and paint a guide before sending.')
  }
  if (!validGuides(guide)) throw bad('The edit guide is invalid or too large.')
  const style = body.style ?? null
  if (style !== null && !validStyleVersion(style,getAsset)) {
    throw bad('The style snapshot contains an invalid rule or a missing example.')
  }
  const effectivePrompt = frozenPrompt ?? promptParts({
    prompt,inputs:assets,target,guideMode,rules:style?.rules ?? [],styleName:style?.name,
  }).map((part) => part.text).join(' ')
  if (typeof effectivePrompt !== 'string' || !effectivePrompt.trim() || effectivePrompt.length > 30000) {
    throw bad('The full prompt must be between 1 and 30,000 characters.')
  }
  return {id, prompt, label:prompt.slice(0,65), inputs, target, parent:parent ?? target,
    guideMode, guide, guidePng:guideMode === 'whole' ? undefined : guidePng, settings, style, effectivePrompt, rect}
}

function validCandidate(candidate, hasAsset) {
  return object(candidate) && hasAsset(candidate.id) && hasAsset(candidate.rawId) &&
    ['pending','done','failed'].includes(candidate.reviewStatus) &&
    Array.isArray(candidate.checks) && candidate.checks.every((check) =>
      object(check) && typeof check.id === 'string' && typeof check.title === 'string' &&
      typeof check.obs === 'string' && judgments.includes(check.status) &&
      (check.loc === undefined || check.loc === 'area' || isFocalArea(check.loc)) &&
      (check.override === undefined || typeof check.override === 'string') &&
      (check.revise === undefined || typeof check.revise === 'string'))
}

export function validateRuns(runs, assets) {
  if (!Array.isArray(runs)) throw bad('The project has invalid run records.')
  const lookup = new Map(assets.map((asset) => [asset.id,asset]))
  const ids = new Set()
  const candidateIds = new Set()
  for (const run of runs) {
    normalizedRun(run,(id) => lookup.get(id),run?.effectivePrompt)
    if (ids.has(run.id) || typeof run.label !== 'string' || typeof run.effectivePrompt !== 'string' ||
        typeof run.createdAt !== 'string' || !Number.isFinite(Date.parse(run.createdAt)) ||
        !states.includes(run.status) || !providers.includes(run.provider) ||
        (run.reviewer !== undefined && (!object(run.reviewer) || typeof run.reviewer.model !== 'string' ||
          typeof run.reviewer.instruction !== 'string')) ||
        (run.rawIds !== undefined && (!Array.isArray(run.rawIds) || !run.rawIds.every((id) => lookup.has(id)))) ||
        !Array.isArray(run.candidates) || !run.candidates.every((candidate) => validCandidate(candidate,(id) => lookup.has(id)))) {
      throw bad('The project has invalid run records.')
    }
    ids.add(run.id)
    for (const {id} of run.candidates) {
      if (candidateIds.has(id)) throw bad('The project has duplicate candidates.')
      candidateIds.add(id)
    }
  }
}

function restoredRuns(runs) {
  let changed = false
  for (const run of runs) {
    if (run.status === 'pending') {
      changed = true
      const atRisk = run.provider === 'live' && run.dispatched !== false
      run.status = atRisk ? 'uncertain' : 'failed'
      run.retryNeedsConfirmation = atRisk
      run.error = atRisk
        ? 'Charcoal closed before the provider confirmed completion. Retry only if you accept a possible duplicate charge.'
        : 'Charcoal closed before the run finished. Retry the run.'
    }
    for (const candidate of run.candidates) {
      if (candidate.reviewStatus !== 'pending') continue
      changed = true
      candidate.reviewStatus = 'failed'
      candidate.reviewError = 'Charcoal closed during review. Rerun the image checks.'
      for (const rule of checkRules(run)) {
        if (!candidate.checks.some((check) => check.id === rule.id)) candidate.checks.push(incompleteCheck(rule))
      }
    }
  }
  return changed
}

export function createJobs(store, provider, engine) {
  const busy = new Set()
  const list = () => store.get('runs',[])
  const get = (id) => list().find((run) => run.id === id)
  const save = (update) => {
    const runs = list()
    const index = runs.findIndex((run) => run.id === update.id)
    if (index < 0) runs.push(update)
    else runs[index] = update
    store.set('runs',runs)
  }
  const recovery = () => {
    const runs = list()
    if (restoredRuns(runs)) store.set('runs',runs)
  }
  const bytes = (id) => {
    const data = readAsset(store,id)?.bytes
    if (!data) throw new Error('An image in this run is missing.')
    return data
  }

  recovery()

  async function review(runId, candidateId) {
    const key = `review:${candidateId}`
    if (busy.has(key)) return
    busy.add(key)
    const run = get(runId)
    const candidate = run.candidates.find((entry) => entry.id === candidateId)
    candidate.reviewStatus = 'pending'
    delete candidate.reviewError
    save(run)
    const checks = candidate.checks.filter((check) => check.id === 'pixel')
    const rules = checkRules(run)
    let failure
    try {
      if (rules.length) {
        const art = bytes(candidateId)
        for (const rule of rules) {
          try {
            if (!engine || run.provider !== provider) {
              throw new Error('Reopen this workspace with its original review provider before rerunning image checks.')
            }
            const examples = rule.ex.map((example) => ({...example,bytes:bytes(example.id)}))
            const check = await engine.check(rule,art,examples,run.reviewer)
            if (!check || !judgments.includes(check.status) || typeof check.obs !== 'string') {
              throw new Error('The reviewer returned an unreadable judgment.')
            }
            checks.push({...check,id:rule.id,title:rule.title})
          } catch (error) {
            failure = error.message
            checks.push(incompleteCheck(rule))
          }
        }
      }
    } catch (error) {
      failure = error.message
      for (const rule of rules) checks.push(incompleteCheck(rule))
    } finally {
      try {
        const latest = get(runId)
        const current = latest.candidates.find((entry) => entry.id === candidateId)
        current.checks = checks.map((check) => {
          const previous = current.checks.find((entry) => entry.id === check.id)
          return previous?.override ? {...check,override:previous.override} : check
        })
        current.reviewStatus = failure ? 'failed' : 'done'
        current.reviewError = failure
        save(latest)
      } finally {
        busy.delete(key)
      }
    }
  }

  async function execute(initial) {
    const {id,guideMode,guidePng,settings,label} = initial
    let run = initial
    busy.add(id)
    let generated = false
    try {
      if (!engine) throw new Error('Set OPENAI_API_KEY in the local service and restart Charcoal, or launch the fixture workspace.')
      const inputs = run.inputs.map(bytes)
      const [width,height] = SIZES[settings.size].split('x').map(Number)
      const regional = guideMode === 'whole' ? null
        : await prepareRegional(inputs[0],Buffer.from(guidePng,'base64'),guideMode,width,height)
      if (regional) inputs[0] = regional.first
      run.dispatched = true
      save(run)
      const result = await engine.generate(run,inputs,regional)
      generated = true
      run.usage = result.usage
      run.retryNeedsConfirmation = provider === 'live'
      save(run)
      const failures = []
      const expected = Number(settings.count)
      const images = result.images.slice(0,expected)
      if (images.length < expected) failures.push(`received ${images.length} of ${expected} requested variations`)
      for (const [i,raw] of images.entries()) {
        const rawId = `${id}-raw-${i+1}`
        const candidateId = `${id}-out-${i+1}`
        const name = `${label}${expected > 1 ? ` ${i+1}` : ''}.png`
        try {
          await importAsset(store,{name:`Raw response ${i+1}.png`,bytes:raw},{id:rawId})
          run = get(id)
          run.rawIds.push(rawId)
          save(run)
          const output = regional ? await unframe(raw,regional,guideMode === 'mask') : {bytes:raw}
          await importAsset(store,{name,bytes:output.bytes},{id:candidateId,normalized:regional !== null})
          const checks = output.exactPixels === undefined ? [] : [{
            id:'pixel',title:'Outside the edit area',status:'pass',loc:'area',
            obs:`All ${output.exactPixels.toLocaleString('en-US')} protected pixels match the normalized source exactly.`,
          }]
          run = get(id)
          run.candidates.push({id:candidateId,rawId,checks,reviewStatus:'pending'})
          save(run)
        } catch (error) {
          failures.push(`Variation ${i+1}: ${error.message}`)
        }
      }
      run = get(id)
      if (failures.length) throw new Error(failures.join(' '))
      run.status = 'done'
      delete run.retryNeedsConfirmation
    } catch (error) {
      run = get(id)
      run.status = error.uncertain ? 'uncertain' : 'failed'
      run.retryNeedsConfirmation = provider === 'live' && (generated || Boolean(error.uncertain))
      run.error = run.rawIds.length ? `${error.message} Saved raw responses are available in the run record.` : error.message
    } finally {
      try { save(run) } finally { busy.delete(id) }
    }
    for (const candidate of run.candidates) {
      if (candidate.reviewStatus === 'pending') await review(id,candidate.id)
    }
  }

  function submit(body,original) {
    if (typeof body?.id === 'string' && get(body.id)) return get(body.id)
    const newRun = normalizedRun(body,store.getAsset,original?.effectivePrompt)
    const run = {...newRun,status:'pending',provider,reviewer:engine?.reviewer,candidates:[],rawIds:[],
      dispatched:false,retriedFrom:original?.id,createdAt:new Date().toISOString()}
    save(run)
    void execute(run).catch((error) => console.error(error.message))
    return run
  }

  return {
    list, get, recovery, submit,
    get busy() { return busy.size > 0 },
    retry(id,retryId,confirmed) {
      const run = get(id)
      if (!run || !['failed','uncertain'].includes(run.status)) throw bad('This request cannot be retried.',409)
      const existing = list().find((attempt) => attempt.retriedFrom === id)
      if (existing) return existing
      if (provider === 'live' && (run.retryNeedsConfirmation || run.status === 'uncertain' || run.provider === 'fixture') &&
          confirmed !== true) throw bad('Confirm the possible additional charge before retrying.',409)
      return submit({...run,id:retryId},run)
    },
    updateCandidate(runId,id,action) {
      const run = get(runId)
      const candidate = run?.candidates.find((entry) => entry.id === id)
      if (!candidate) throw bad('Candidate not found.',404)
      if (!object(action)) throw bad('Unknown candidate action.')
      if (action.kind === 'seen') candidate.seen = true
      else if (action.kind === 'review') {
        if (run.status === 'pending') throw bad('Wait for generation to finish before rerunning the checks.',409)
        if (provider === 'live' && run.reviewer && run.reviewer.model !== engine?.reviewer?.model) {
          throw bad('This run used a different review model. Start a new run or configure the original model locally.',409)
        }
        void review(runId,id).catch((error) => console.error(error.message))
        return
      } else if (action.kind === 'keep') {
        const unresolved = (check) => check.status !== 'pass' && !check.override
        const missing = checkRules(run).some((rule) => !candidate.checks.some((check) => check.id === rule.id))
        if (candidate.reviewStatus === 'pending' || missing || candidate.checks.some(unresolved)) {
          throw bad('Resolve or override the remaining checks before keeping this result.',409)
        }
        candidate.kept = true
      } else if (action.kind === 'override') {
        const check = candidate.checks.find((entry) => entry.id === action.checkId && entry.status !== 'pass')
        const reason = typeof action.reason === 'string' ? action.reason.trim() : ''
        if (!check || !reason || reason.length > 4000) throw bad('Enter a reason to override this check.')
        check.override = reason
      } else throw bad('Unknown candidate action.')
      save(run)
    },
  }
}
