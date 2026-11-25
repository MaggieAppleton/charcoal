import type {Asset} from './model'
import {imageMention,parseImageMentions} from './image-mentions.js'

export type TextSelection = {start:number;end:number}

export function editorText(root:Node):string {
  if (root instanceof HTMLElement && root.dataset.editorTail) return ''
  if (root instanceof HTMLElement && root.dataset.imageId) return imageMention(root.dataset.imageId)
  // Browsers use nonbreaking spaces to keep caret-adjacent spaces visible.
  if (root.nodeType === Node.TEXT_NODE) return (root.textContent ?? '').replace(/\u00a0/g,' ')
  if (root instanceof HTMLElement && root.id==='prompt' && root.childNodes.length===1 && root.firstChild?.nodeName==='BR') return ''
  if (root.nodeName === 'BR') return '\n'
  let text=''
  for (const child of root.childNodes) {
    const block=child.nodeName==='DIV'||child.nodeName==='P'
    if (block && text && !text.endsWith('\n')) text+='\n'
    text+=editorText(child)
  }
  return text
}

export function readSelection(root:HTMLElement):TextSelection|null {
  const selection=window.getSelection()
  if (!selection?.rangeCount) return null
  const range=selection.getRangeAt(0)
  if (!root.contains(range.startContainer)||!root.contains(range.endContainer)) return null
  const before=range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer,range.startOffset)
  const through=before.cloneRange()
  through.setEnd(range.endContainer,range.endOffset)
  return {start:editorText(before.cloneContents()).length,end:editorText(through.cloneContents()).length}
}

export function restoreSelection(root:HTMLElement,selection:TextSelection) {
  function position(offset:number):[Node,number] {
    let remaining=Math.max(0,offset)
    for (let index=0;index<root.childNodes.length;index++) {
      const child=root.childNodes[index]
      const length=editorText(child).length
      if (remaining<=length) {
        if (child.nodeType===Node.TEXT_NODE) return [child,remaining]
        return [root,index+Number(remaining>0)]
      }
      remaining-=length
    }
    return [root,root.childNodes.length]
  }
  const range=document.createRange()
  range.setStart(...position(selection.start))
  range.setEnd(...position(selection.end))
  const current=window.getSelection()
  current?.removeAllRanges()
  current?.addRange(range)
}

export function updateMentionLabels(root:HTMLElement,inputs:Asset[]) {
  for (const mention of root.querySelectorAll<HTMLElement>('[data-image-id]')) {
    const index=inputs.findIndex(asset=>asset.id===mention.dataset.imageId)
    const asset=inputs[index]
    mention.dataset.missing=asset?'false':'true'
    mention.setAttribute('aria-label',asset?`Image ${index+1}: ${asset.name}`:'Missing image reference')
    const label=mention.querySelector('span')!
    label.textContent=asset?String(index+1):'Missing image'
    const preview=mention.querySelector('img')!
    preview.hidden=!asset
    if (asset && preview.getAttribute('src')!==asset.url) preview.setAttribute('src',asset.url)
  }
}

export function renderEditor(root:HTMLElement,text:string,inputs:Asset[]) {
  const fragment=document.createDocumentFragment()
  for (const part of parseImageMentions(text)) {
    if (part.type==='text') {
      for (const [index,line] of part.text.split('\n').entries()) {
        if (index) fragment.append(document.createElement('br'))
        if (line) fragment.append(document.createTextNode(line))
      }
      continue
    }
    const mention=document.createElement('span')
    mention.className='prompt-image-mention'
    mention.contentEditable='false'
    mention.dataset.imageId=part.id
    mention.setAttribute('role','img')
    const preview=document.createElement('img')
    preview.alt=''
    preview.draggable=false
    mention.append(preview,document.createElement('span'))
    fragment.append(mention)
  }
  // A final newline needs a second, non-content break to keep its caret line.
  if (text.endsWith('\n')) {
    const tail=document.createElement('br')
    tail.dataset.editorTail='true'
    fragment.append(tail)
  }
  root.replaceChildren(fragment)
  updateMentionLabels(root,inputs)
}
