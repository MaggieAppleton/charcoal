import {imageMention,parseImageMentions} from './image-mentions.js'

/** Move the previous form's instructions into visible, editable prose once.
 * @param {import('./model').Workspace} workspace
 * @returns {import('./model').Workspace}
 */
export function migrateInlineReferences(workspace) {
  if (workspace.inlineReferencesVersion === 1) return workspace
  const ids=workspace.target
    ? [workspace.target,...workspace.attachments.filter(id=>id!==workspace.target)] : workspace.attachments
  const existing=new Set(parseImageMentions(workspace.prompt).flatMap(part=>part.type==='image'?[part.id]:[]))
  const notes=ids.flatMap(id=>{
    if (existing.has(id)) return []
    const direction=workspace.referenceDirections?.[id]
    return [[imageMention(id),direction?.roles.length?`Use its ${direction.roles.join(', ')}.`:'',
      direction?.use.trim(),direction?.avoid.trim()?`Avoid ${direction.avoid.trim()}`:''].filter(Boolean).join(' ')]
  })
  return {...workspace,inlineReferencesVersion:1,prompt:[workspace.prompt,...notes].filter(Boolean).join('\n\n')}
}

/** @param {string} prompt @param {string[]} attachments */
export function missingImageMentions(prompt,attachments) {
  const ids=new Set(attachments)
  return parseImageMentions(prompt).flatMap(part=>part.type==='image'&&!ids.has(part.id)?[part.id]:[])
}

/** @param {string} prompt */
export function hasPromptText(prompt) {
  return parseImageMentions(prompt).some(part=>part.type==='text'&&part.text.trim())
}

/** @param {string} prompt @param {ReadonlySet<string>} inputs */
export function keepAttachedMentions(prompt,inputs) {
  return parseImageMentions(prompt).map(part=>part.type==='text' ? part.text
    : inputs.has(part.id) ? imageMention(part.id) : '').join('')
}

/**
 * A draft mention and its ordered request input must move together. When loading
 * older drafts, recover references from the board's assets before removing tokens
 * that cannot resolve.
 * @param {import('./model').Workspace} workspace
 * @param {import('./model').Asset[]} assets
 * @returns {import('./model').Workspace}
 */
export function recoverInlineReferences(workspace,assets) {
  const available=new Set(assets.map(asset=>asset.id))
  const target=workspace.target && available.has(workspace.target) ? workspace.target : null
  const attachments=workspace.attachments.filter(id=>available.has(id)&&id!==target)
  const selected=new Set(target?[target,...attachments]:attachments)
  const deleted=new Set(workspace.deletedImageIds)
  for (const part of parseImageMentions(workspace.prompt)) {
    if (selected.size>=8) break
    if (part.type==='image' && available.has(part.id) && !selected.has(part.id) && !deleted.has(part.id)) {
      attachments.push(part.id)
      selected.add(part.id)
    }
  }
  const prompt=keepAttachedMentions(workspace.prompt,selected)
  if (prompt===workspace.prompt && target===workspace.target && attachments.length===workspace.attachments.length) return workspace
  return {...workspace,prompt,attachments,target,guideMode:target===workspace.target?workspace.guideMode:'whole'}
}
