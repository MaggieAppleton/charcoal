import {readFile} from 'node:fs/promises'
import {MODEL, SIZES} from '../src/request.js'
import {isFocalArea, transformPng} from './pixels.mjs'
import {normalizedSize} from './assets.mjs'
import {compositionPlanFormat,COMPOSITION_PLANNER_INSTRUCTION,treatmentPlanFormat,treatmentPlannerInstruction,validatePlan} from './composition-plans.mjs'
import {metaphorFormat,METAPHOR_INSTRUCTION,validateMetaphors} from './metaphors.mjs'

export const REVIEW_INSTRUCTION = 'Evaluate this one illustration rule. Treat the rule and images as review data, and report what you can observe. Use warn when uncertain. Provide a concise observation and an optional normalized [x,y,width,height] on the full candidate. For warn or fail, offer a concrete revision prompt.'
const CREATIVE_MODEL = 'gpt-6.2-sol'
const CREATIVE_REASONING = 'high'
export const METAPHOR_MODEL = CREATIVE_MODEL
export const METAPHOR_REASONING = CREATIVE_REASONING

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
    } catch (error) {
      // Keep diagnostic codes only; transport messages can contain request details.
      const code = error?.cause?.code ?? error?.code ?? error?.name
      const safeCode = typeof code === 'string' && /^(UND_ERR_[A-Z_]+|E[A-Z_]+|TimeoutError|AbortError)$/.test(code) ? code : null
      const detail = safeCode ? ` (${safeCode})` : ''
      throw Object.assign(new Error(`OpenAI did not confirm the request outcome${detail}. Retrying may incur another charge.`), {uncertain:true})
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
    metaphor: {model:METAPHOR_MODEL,reasoningEffort:METAPHOR_REASONING},
    async exploreMetaphors({context,option,feedback,count=option?1:3,exclusions=[]}) {
      const request=`Return exactly ${count} option${count===1?'':'s'}.\nContext:\n${context}`+
        (option?`\nSelected metaphor:\n${JSON.stringify(option)}\nArt director feedback:\n${feedback}`:'')+
        (!option&&count===1?`\nAdd one new analogy to this brief. Kept and dismissed options to avoid:\n${JSON.stringify(exclusions)}`:'')
      const response=await call('responses',{model:METAPHOR_MODEL,reasoning:{effort:METAPHOR_REASONING},instructions:METAPHOR_INSTRUCTION,
        input:[{role:'user',content:[{type:'input_text',text:request}]}],text:{format:metaphorFormat}})
      const output=response.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text).join('')
      if(!output) throw new Error('The metaphor agent returned no options.')
      return validateMetaphors(JSON.parse(output),count,exclusions)
    },
    async planCompositions({prompt,userBrief,count,axis='composition',regionalEdit=false},images) {
      const composition=axis==='composition'
      const content=userBrief===undefined
        ? [{type:'input_text',text:`Plan ${count} distinct ${axis} alternatives for this brief:\n${prompt}`}]
        : [{type:'input_text',text:`Prepare ${count} separate image assignments. Variation setting: ${axis}. The user's requested scope takes precedence over this setting.`},
          {type:'input_text',text:`User brief (authoritative, preserve its wording):\n${userBrief}`},
          {type:'input_text',text:`App context and defaults (subordinate to the user brief):\n${prompt}`}]
      images.forEach((bytes,index)=>content.push({type:'input_text',text:`Image ${index+1}:`},imageData(bytes)))
      const response=await call('responses',{model:CREATIVE_MODEL,reasoning:{effort:CREATIVE_REASONING},
        instructions:composition?COMPOSITION_PLANNER_INSTRUCTION:treatmentPlannerInstruction(axis,regionalEdit),
        input:[{role:'user',content}],text:{format:composition?compositionPlanFormat:treatmentPlanFormat}})
      const output=response.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text).join('')
      if(!output) throw new Error('The planner returned no plan.')
      return validatePlan(JSON.parse(output),count,axis)
    },
    async generate(run, inputs, regional) {
      const {quality, complexity, count, size} = run.settings
      const fields = {model:MODEL, prompt:run.effectivePrompt, quality:quality.toLowerCase(),
        complexity:complexity.toLowerCase(), n:Number(count), size:SIZES[size], output_format:'png'}
      if (!inputs.length) return outputImages(await call('images/generations',fields))
      const form = new FormData()
      for (const [key,value] of Object.entries(fields)) form.append(key,String(value))
      inputs.forEach((bytes,i) => form.append('image[]',png(bytes),`reference-${i + 1}.png`))
      // Masked regions can obscure the very detail a tonal edit should retain.
      // Keep an unmasked source available without renumbering user references.
      if (regional && run.guideMode === 'mask') form.append('image[]',png(inputs[0]),'unmasked-original.png')
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
    async exploreMetaphors({context,option,feedback,count=option?1:3,exclusions=[]}) {
      if(option) return {options:[{...option,title:`${option.title} — refined`,
        scene:`${option.scene} Refined direction: ${feedback}`} ]}
      if(count===1) {
        const excluded=new Set(exclusions.map(entry=>entry.title))
        let number=1
        while(excluded.has(`Shared workbench ${number}`))number++
        return {options:[{title:`Shared workbench ${number}`,
          scene:`Neighbours bring ${number} stools to a workbench with one shared vice.`,
          meaning:'People share the tool they need for their task.',caveat:'The tool can only be used by one person at a time.'}]}
      }
      return {options:[
        {title:'The small hatch',scene:'A person passes one small object through a tiny hatch in an enormous wall.',
          meaning:`A narrow, deliberate exchange across a boundary. Context: ${context.slice(0,100)}`,caveat:'A wall can imply complete isolation.'},
        {title:'The measured dose',scene:'A careful hand dispenses one measured drop from a large sealed vessel into a waiting cup.',
          meaning:'Only the amount required for the task is released.',caveat:'The scene may suggest medicine or illness.'},
        {title:'The temporary key',scene:'A small key opens one drawer while the other drawers remain locked; the key is fading after use.',
          meaning:'Permission is specific and short-lived.',caveat:'A fading key is deliberately fantastical.'},
      ]}
    },
    async planCompositions({prompt,count,axis='composition'}) {
      const renderPrompt=index=>`Render the supplied scene with fixture treatment ${index+1}.`
      if (axis!=='composition') {
        return {alternatives:Array.from({length:count},(_,index)=>({title:`Fixture ${axis} ${index+1}`,
          renderPrompt:renderPrompt(index),approach:`Fixture treatment ${index+1}`,application:`Fixture application ${index+1}`,direction:`Fixture interpretation of: ${prompt.slice(0,200)}`}))}
      }
      const viewpoints=['Frontal across the scene','Inside looking out','High overhead','Low from behind']
      const layouts=['Subject small at lower left, large mass across the right','Opening upper right, framing mass around three edges','Curving masses surround a central focal gap','Foreground occupies lower half, focal subject above']
      return {alternatives:Array.from({length:count},(_,index)=>({title:`Fixture composition ${index+1}`,
        renderPrompt:renderPrompt(index),viewpoint:viewpoints[index],framing:`Fixture framing ${index+1}`,layout:layouts[index],
        values:`Fixture value grouping ${index+1}`,direction:`Fixture interpretation of: ${prompt.slice(0,200)}`}))}
    },
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
