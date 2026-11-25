const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
const mentionPattern = /\[\[image:([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\]\]/g

/** @param {string} id */
export function imageMention(id) {
  if (!idPattern.test(id)) throw new Error('Invalid image reference.')
  return `[[image:${id}]]`
}

/**
 * @param {string} text
 * @returns {Array<{type:'text',text:string}|{type:'image',id:string}>}
 */
export function parseImageMentions(text) {
  const parts = []
  let end = 0
  for (const match of text.matchAll(mentionPattern)) {
    if (match.index > end) parts.push({type:'text',text:text.slice(end,match.index)})
    parts.push({type:'image',id:match[1]})
    end = match.index + match[0].length
  }
  if (end < text.length) parts.push({type:'text',text:text.slice(end)})
  return parts
}

/** @param {string} text @param {{id:string}[]} inputs */
export function resolveImageMentions(text, inputs) {
  return parseImageMentions(text).map(part => {
    if (part.type === 'text') return part.text
    const index = inputs.findIndex(input => input.id === part.id)
    return index < 0 ? '[Missing image reference]' : `Image ${index + 1}`
  }).join('')
}
