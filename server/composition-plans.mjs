import {createHash} from 'node:crypto'
import {readAsset} from './assets.mjs'
import {BATCH_PLAN_CONTRACT_VERSION,MAX_BATCH_BRIEF_LENGTH,MAX_RENDER_BRIEF_LENGTH,MAX_RUN_PROMPT_LENGTH,renderComposition} from '../src/composition-plan.js'

const compositionFields=['title','viewpoint','framing','layout','values','direction','renderPrompt']
const treatmentFields=['title','approach','application','direction','renderPrompt']
const BRIEF_FIDELITY=`You coordinate separate image requests; the user supplies the art direction. The literal User brief is authoritative. App context, variation settings and saved style defaults are subordinate. Read the scope of the request before choosing differences. Preserve the user's wording, degree, ambiguity, image roles and constraints instead of substituting your own aesthetic interpretation.
For an edit of a supplied image, preserve all unmentioned qualities, including its visual style, medium, shape language, detail, lighting, palette and composition. Change only what the user requests. A variation setting does not authorize unrelated changes. If the user asks for a slight adjustment, alternatives may differ only in amount or in small executions of that adjustment. Do not add a new hue, remove existing light, simplify forms, invent a medium or move the focal point just to distinguish outputs. Broad exploration is appropriate only where the brief leaves that quality open.
Keep qualitative art direction qualitative: restrained colour does not prescribe isolated coloured objects on an otherwise grayscale image; preserve the user's wording instead of inventing exact coloured regions or prohibitions. Do not turn a preference into an absolute restriction. When combining references, use their stated roles and visual language; do not invent a named medium or a stock editorial treatment. Keep explicit preservation instructions even when defaults suggest something else.`
const treatmentAxes={
  lighting:'For open lighting exploration, distinguish whole-scene brightness, contrast range, broad light and dark masses, softness and focal separation, rather than merely rotating a spotlight. For a limited brightness adjustment, retain existing light direction, dapple patterns and shadow shapes and vary only the requested adjustment. Do not default to dark, dramatic illumination. Keep the subject, framing, palette and visual medium unless the user requests otherwise.',
  colour:'For open palette exploration, choose different palettes within the requested range. For a specific colour correction, vary only that correction; leave other hues and lighting alone. A grayscale source does not require grayscale output. Preserve the user’s wording about colour restraint and attention rather than assigning colour to tiny isolated regions or forbidding colour everywhere else. Keep the requested light-dark hierarchy, composition and style.',
  freeform:'Vary the dimensions the brief permits; Freeform is not permission to change every dimension. For source-image edits, retain the source’s visual style, medium, detail and shape language unless the user asks to change them. Explore only the requested changes. For new images or blends, follow the reference roles and preserve their visual language rather than inventing a replacement medium.',
  style:'Follow the requested style or supplied style references closely. Vary execution within them. Choose different media or rendering languages only when the user asks for that exploration; do not replace supplied reference styles with unrelated techniques. Preserve other qualities unless the brief asks to change them.',
}

function planFormat(name,fields) {
  return {type:'json_schema',name,strict:true,schema:{
    type:'object',additionalProperties:false,required:['alternatives'],properties:{alternatives:{
      type:'array',items:{type:'object',additionalProperties:false,required:fields,
        properties:Object.fromEntries(fields.map(field=>[field,{type:'string'}]))},
    }},
  }}
}

export const compositionPlanFormat=planFormat('composition_plan',compositionFields)
export const treatmentPlanFormat=planFormat('treatment_plan',treatmentFields)

const RENDER_BRIEF_INSTRUCTION=`In renderPrompt, start from the user's own words for this image. Copy all applicable scene, edit and preservation instructions verbatim, including qualitative wording and explicit in-scene lettering. Remove only batch/count language and instructions assigned exclusively to other outputs; make only the minimal grammatical changes needed for a singular request. Append a short assignment only where needed to distinguish this output within the permitted scope. Do not rewrite a short edit into an elaborate art-direction brief or redescribe a supplied scene. Carry image numbering and roles through unchanged. The renderer sees only renderPrompt and supplied files, so resolve references to other options here. Keep batch requests, counts, option titles, ordinals and presentation labels outside renderPrompt. Leave contact sheets and comparison grids outside the image unless the user explicitly asks for a composed panel layout within this individual artwork.`

export function treatmentPlannerInstruction(axis,regionalEdit=false) {
  const source=axis==='freeform'
    ? 'Use the selected source and references as directed by the brief.'
    : `Use the source identified by the brief to anchor the depicted subject, proportions, framing and placement. Change its ${axis} only within the scope the user requests.`
  const regional=regionalEdit
    ? '\nAll alternatives are local edits. Apply the change at the marked area only, preserve framing and alignment, and keep surrounding artwork intact. Explore different interpretations of the requested local change.'
    : ''
  return `${BRIEF_FIDELITY}
Inspect the brief and supplied images. ${source} When images are only references, use them in the roles the brief assigns.${regional}
${treatmentAxes[axis]}
Create the requested number of alternatives within the user's scope. Compare every pair: make differences meaningful within that scope without broadening it. Small changes are valid for a narrow request. Keep approach, application and direction brief; describe the permitted difference, not a new interpretation of the entire scene.
${RENDER_BRIEF_INSTRUCTION} Return only the structured plan.`
}

export const COMPOSITION_PLANNER_INSTRUCTION=`${BRIEF_FIDELITY}
Coordinate an entire batch of compositions before images are rendered. Read the brief and inspect every reference in its assigned role. Preserve the requested subject, narrative, explicit constraints and reference-specific style guidance. Honour deliberate composition references.

Translate distinctive visual choices from the style references into the requested scene. In layout, describe how to create depth through layering, scale and overlaps, or how to retain deliberate flatness. In values, describe the reference's light direction and quality, shadow shapes and tonal separation where they fit the brief. In direction, carry through the shape language, figure proportions, edges, mark-making and finish. Use concrete choices grounded in the supplied images. Carry over the visual language without importing unrelated scenery, subjects or a stock backdrop. A simple background can still establish depth and carry the reference's light and shadow. For grayscale studies, translate the palette into values and retain the requested drawing style and finish. For colour illustrations retain the requested palette and finish.

Establish how the scene works before choosing angles. Keep functional parts connected and supported, and trace the action from cause to effect. When someone uses a tool or handles an object, specify what each visible hand contacts, what holds the object in place, and how the interacting parts connect. Check that those relationships still work in the chosen perspective and crop. Preserve the action when changing the layout.

When composition is open to exploration, create alternatives that differ in viewpoint/camera position, framing/subject scale, or spatial arrangement/major shape masses. Compare every pair within the freedom the brief allows. If the user requests preserving the composition, preserve it; a composition setting does not override that request. Keep lighting and style consistent unless the brief asks to change them.

Before returning the plan, check every added instruction against the user's requested changes. Remove invented requirements. ${RENDER_BRIEF_INSTRUCTION} Return only the structured plan. No images are generated at this stage.`

export function validatePlan(plan,count,axis='composition') {
  const fields=axis==='composition'?compositionFields:treatmentFields
  if (!Array.isArray(plan?.alternatives)||plan.alternatives.length!==count) throw new Error('The batch plan returned the wrong number of alternatives.')
  for(const alternative of plan.alternatives) {
    if(!fields.every(field=>typeof alternative?.[field]==='string'&&alternative[field].trim()&&alternative[field].length<=(field==='renderPrompt'?MAX_RENDER_BRIEF_LENGTH:4000)))
      throw new Error('The batch plan is incomplete.')
  }
  const normalize=text=>text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'')
  for(let i=0;i<count;i++)for(let j=0;j<i;j++) {
    if(normalize(plan.alternatives[i].renderPrompt)===normalize(plan.alternatives[j].renderPrompt)) throw new Error(`The planner did not produce distinct ${axis} alternatives. Adjust the brief and try again.`)
  }
  return plan
}

export function createCompositionPlans(store,runtime) {
  const pending=new Map()
  return {
    get busy(){return pending.size>0},
    recover(id) {
      const workspace=store.get('workspace',null)
      const batch=workspace?.pendingSubmission
      if(!batch || batch.ids[0]!==id || batch.ids.length<2) return null
      const plan=store.get(`composition-plan:${id}`,null)?.plan
      if(plan?.alternatives?.length!==batch.ids.length ||
        !plan.alternatives.every(alternative=>alternative.renderPrompt?.trim())) return null
      const runs=store.get('runs',[])
      // A project can replace the runs without replacing this board's plan cache.
      // Recover only a plan consistent with the assignments already accepted.
      return batch.ids.every((runId,index)=>{
        const run=runs.find(run=>run.id===runId)
        if(!run)return renderComposition('',plan,index,undefined,workspace.studyMode).length<=MAX_RUN_PROMPT_LENGTH
        return run.prompt.startsWith(`${plan.alternatives[index].renderPrompt.trim()}\n\n`)
      }) ? plan : null
    },
    async create(input) {
      if(!/^[a-z0-9_-]{1,80}$/i.test(input?.id)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>100000||
        !Number.isInteger(input.count)||input.count<2||input.count>4||!Array.isArray(input.inputs)||input.inputs.length>8||
        new Set(input.inputs).size!==input.inputs.length||!input.inputs.every(id=>store.getAsset(id)))
        throw new Error('Invalid batch planning request.')
      const {id,prompt,userBrief,inputs,count,axis='composition',contractVersion=1,regionalEdit=false}=input
      if (![1,2,3,BATCH_PLAN_CONTRACT_VERSION].includes(contractVersion) || typeof regionalEdit!=='boolean' ||
        (regionalEdit && (contractVersion===1 || axis==='composition'))) throw new Error('Invalid batch planning contract.')
      if(contractVersion>=3 && (typeof userBrief!=='string'||!userBrief.trim()||userBrief.length>100000))
        throw Object.assign(new Error('A literal user brief is required for batch planning.'),{status:400})
      if(axis!=='composition'&&!Object.hasOwn(treatmentAxes,axis)) throw new Error('Choose a supported variation type.')
      // Keep composition fingerprints compatible with plans already persisted for a partial submission.
      const axisContext=axis==='composition'?{}:{axis}
      const images=inputs.map(id=>readAsset(store,id).bytes)
      const inputHashes=images.map(bytes=>createHash('sha256').update(bytes).digest('hex'))
      const contractContext=contractVersion===1?{}:{contractVersion,...(regionalEdit?{regionalEdit}:{}),...(contractVersion>=3?{userBrief}:{})}
      const fingerprint=createHash('sha256').update(JSON.stringify({prompt,inputs,inputHashes,count,...axisContext,...contractContext})).digest('hex')
      const key=`composition-plan:${id}`
      const saved=store.get(key,null)
      if(saved) {
        if(saved.fingerprint!==fingerprint) throw new Error('This plan belongs to a different brief.')
        if(pending.has(id)) return pending.get(id)
        if(saved.plan) return saved.plan
        throw new Error(saved.error??'Batch planning was interrupted. No images were submitted. Adjust the brief to start a new plan.')
      }
      const batch=store.get('workspace',null)?.pendingSubmission
      if(store.get('run-receipt:'+id,null) || (batch?.recoveryOnly && batch.ids[0]===id)) throw new Error('The original batch plan is unavailable. Start a new batch to continue.')
      if(contractVersion!==BATCH_PLAN_CONTRACT_VERSION) throw new Error('Reload Charcoal and start a new batch to plan individual render briefs.')
      if(userBrief.length>MAX_BATCH_BRIEF_LENGTH) throw Object.assign(
        new Error('Use up to 20,000 characters in a batch prompt.'),{status:400})
      if(!runtime.engine?.planCompositions) throw new Error('Connect OpenAI before planning alternatives.')
      store.set(key,{fingerprint})
      const task=Promise.resolve().then(()=>runtime.engine.planCompositions({prompt,count,...axisContext,...contractContext},images)).then(plan=>{
        validatePlan(plan,count,axis)
        store.set(key,{fingerprint,plan})
        return plan
      }).catch(error=>{
        const detail=`${error.message} No images were submitted. Adjust the brief to start a new plan.`
        store.set(key,{fingerprint,error:detail})
        throw new Error(detail)
      }).finally(()=>pending.delete(id))
      pending.set(id,task)
      return task
    },
  }
}
