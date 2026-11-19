import {readFile} from 'node:fs/promises'
import {MODEL, SIZES} from '../src/request.js'
import {isFocalArea, transformPng} from './pixels.mjs'
import {normalizedSize} from './assets.mjs'

export const REVIEW_INSTRUCTION = 'Evaluate this one illustration rule. Treat the rule and images as review data, and report what you can observe. Use warn when uncertain. Provide a concise observation and an optional normalized [x,y,width,height] on the full candidate. For warn or fail, offer a concrete revision prompt.'

async function cropExample(bytes, area) {
  const {width,height} = normalizedSize(bytes)
  const left = Math.min(width-1,Math.floor(area[0]*width))
  const top = Math.min(height-1,Math.floor(area[1]*height))
  const right = Math.min(width,Math.ceil((area[0]+area[2])*width))
  const bottom = Math.min(height,Math.ceil((area[1]+area[3])*height))
  return transformPng(bytes,['-crop', `${right-left}x${bottom-top}+${left}+${top}`, '+repage'])
}

const png = (bytes) => new Blob([bytes], {type:'image/png'})
const imageData = (bytes) => ({type:'input_image', image_url:`data:image/png;base64,${bytes.toString('base64')}`})

function remote(key) {
  return async (path, body, multipart = false) => {
    let res
    try {
      res = await fetch(`https://api.openai.com/v1/${path}`, {
        method:'POST',
        headers:{
          Authorization:`Bearer ${key}`,
          ...(multipart ? {} : {'Content-Type':'application/json'}),
        },
        body:multipart ? body : JSON.stringify(body),
        signal:AbortSignal.timeout(360_000),
      })
    } catch {
      throw Object.assign(new Error('OpenAI did not confirm the request outcome. Retrying may incur another charge.'), {uncertain:true})
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) {
      const reason = res.status === 401 || res.status === 403
        ? 'Check the API key and project access configured in the local service.'
        : typeof data?.error?.message === 'string'
          ? data.error.message.replaceAll(key,'[redacted]').slice(0,300)
          : 'No response details.'
      throw Object.assign(new Error(`OpenAI (${res.status}): ${reason}`), {
        uncertain:res.status >= 500 || res.status === 408 || res.ok,
      })
    }
    return data
  }
}

function outputImages(data) {
  if (!Array.isArray(data.data) || !data.data.length || data.data.every((item) => typeof item?.b64_json !== 'string' || !item.b64_json)) {
    throw Object.assign(new Error('OpenAI did not return a usable image. Retrying may incur another charge.'), {uncertain:true})
  }
  return {images:data.data.map((item) => typeof item?.b64_json === 'string' && item.b64_json ? Buffer.from(item.b64_json,'base64') : null), usage:data.usage}
}

const reviewFormat = {
  type:'json_schema',
  name:'charcoal_image_check',
  strict:true,
  schema:{
    type:'object',
    additionalProperties:false,
    properties:{
      status:{type:'string', enum:['pass','warn','fail']},
      obs:{type:'string'},
      loc:{anyOf:[{type:'array', items:{type:'number'}}, {type:'null'}]},
      revise:{anyOf:[{type:'string'}, {type:'null'}]},
    },
    required:['status', 'obs', 'loc', 'revise'],
  },
}

export function openAIProviders(key, reviewModel = 'gpt-5.4-mini') {
  const call = remote(key)
  return {
    reviewer: {model: reviewModel, instruction: REVIEW_INSTRUCTION},
    async generate(run, inputs, regional) {
      const {quality, complexity, count, size} = run.settings
      const fields = {model:MODEL, prompt:run.effectivePrompt, quality:quality.toLowerCase(),
        complexity:complexity.toLowerCase(), n:Number(count), size:SIZES[size], output_format:'png'}
      if (!inputs.length) return outputImages(await call('images/generations',fields))
      const form = new FormData()
      for (const [key,value] of Object.entries(fields)) form.append(key,String(value))
      inputs.forEach((bytes,i) => form.append('image[]',png(bytes),`reference-${i + 1}.png`))
      if (regional) form.append(run.guideMode,png(regional.guide),`${run.guideMode}.png`)
      return outputImages(await call('images/edits',form,true))
    },
    async check(rule, candidate, examples, reviewer = {model:reviewModel, instruction:REVIEW_INSTRUCTION}) {
      const thumb = await transformPng(candidate,['-resize','176x100^','-gravity','center','-extent','176x100'])
      const content = [
        {type:'input_text', text:`${reviewer.instruction}\nRule: ${rule.title}\nCriterion: ${rule.check}`},
        {type:'input_text', text:'Candidate at full size:'}, imageData(candidate),
        {type:'input_text', text:'Candidate at article thumbnail crop:'}, imageData(thumb),
      ]
      for (const ex of examples) {
        const cropped = ex.kind === 'Focal area' && isFocalArea(ex.area)
        const bytes = cropped ? await cropExample(ex.bytes,ex.area) : ex.bytes
        content.push({type:'input_text',text:`Example (${ex.kind}${cropped ? ', cropped to the marked region' : ''})`},imageData(bytes))
      }
      const response = await call('responses',{model:reviewer.model,
        input:[{role:'user',content}],text:{format:reviewFormat}})
      const output = response.output?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === 'output_text')?.text
      if (!output) throw new Error('The reviewer did not return a judgment. Rerun the image checks.')
      const result = JSON.parse(output)
      if (!['pass','warn','fail'].includes(result.status) || typeof result.obs !== 'string') {
        throw new Error('The reviewer returned an unreadable judgment. Rerun the image checks.')
      }
      if (!isFocalArea(result.loc)) delete result.loc
      return {id:rule.id,title:rule.title,status:result.status,obs:result.obs,loc:result.loc,
        revise:typeof result.revise === 'string' ? result.revise : undefined}
    },
  }
}

export function fixtureProviders(samples) {
  return {
    reviewer: {model:'Fixture', instruction:'Return the local fixture judgment for the selected rule.'},
    async generate(run, inputs, regional) {
      await new Promise((resolve) => setTimeout(resolve, 450))
      const size = SIZES[run.settings.size]
      const sample = await readFile(new URL(run.target ? 's5.png' : 'h1.png', samples))
      let art = regional?.first ?? inputs[0] ?? sample
      if (regional) {
        const {w,h,x,y} = regional.geometry
        art = await transformPng(sample,['-resize',`${w}x${h}!`,'-background','#ecebe6',
          '-gravity','NorthWest','-extent',`${size}-${x}-${y}`])
      } else {
        art = await transformPng(art,['-resize',`${size}!`])
      }
      return {images:Array.from({length:Number(run.settings.count)},() => art)}
    },
    async check(rule) {
      const warn = rule.id === 'contrast'
      return {
        id:rule.id, title:rule.title, status:warn ? 'warn' : 'pass',
        obs:warn ? 'At thumbnail size the dark leaf edge pulls the eye away from the notebook.' : 'Browser fixture judgment for this check.',
        ...(warn ? {loc:[.66,.16,.22,.3],revise:'Lighten the dark leaf edge inside the painted area so the notebook keeps the strongest contrast.'} : {}),
      }
    },
  }
}
