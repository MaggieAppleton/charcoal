import {useEffect,useImperativeHandle,useLayoutEffect,useRef,type Ref} from 'react'
import type {Asset} from './model'
import {imageMention,resolveImageMentions} from './image-mentions.js'
import {keepAttachedMentions} from './inline-reference-draft.js'
import {editorText,readSelection,renderEditor,restoreSelection,updateMentionLabels,type TextSelection} from './prompt-editor-dom'
import './prompt-editor.css'

export type PromptEditorHandle = {focus:()=>void;insertImages:(ids:string[])=>void}
type Snapshot={text:string;selection:TextSelection}
type Props={
  value:string;inputs:Asset[];onChange:(value:string)=>void;onSubmit:()=>void
  canSubmit:boolean;placeholder:string;ref?:Ref<PromptEditorHandle>
}

export function PromptEditor(props:Props) {
  const root=useRef<HTMLDivElement>(null)
  const latest=useRef(props)
  latest.current=props
  const current=useRef(props.value)
  const caret=useRef<TextSelection>({start:props.value.length,end:props.value.length})
  const before=useRef<TextSelection>(caret.current)
  const composing=useRef(false)
  const undo=useRef<Snapshot[]>([])
  const redo=useRef<Snapshot[]>([])
  const group=useRef({type:'',time:0})

  function remember() {
    const selection=root.current&&readSelection(root.current)
    if (selection) caret.current=selection
  }
  function record(type:string) {
    const time=Date.now()
    if (!type || type!==group.current.type || time-group.current.time>700) {
      undo.current.push({text:current.current,selection:before.current})
      if (undo.current.length>100) undo.current.shift()
    }
    group.current={type,time}
    redo.current=[]
  }
  function publish(text:string) {
    current.current=text
    latest.current.onChange(text)
  }
  function withAttachedImages(text:string) {
    return keepAttachedMentions(text,new Set(latest.current.inputs.map(asset=>asset.id)))
  }
  function replace(text:string,selection:TextSelection) {
    const element=root.current!
    renderEditor(element,text,latest.current.inputs)
    caret.current=selection
    element.focus({preventScroll:true})
    restoreSelection(element,selection)
    publish(text)
  }
  function insert(text:string) {
    remember()
    before.current=caret.current
    record('')
    const {start,end}=caret.current
    const result=current.current.slice(0,start)+text+current.current.slice(end)
    replace(result,{start:start+text.length,end:start+text.length})
  }
  function history(back:boolean) {
    remember()
    const from=back?undo:redo
    const to=back?redo:undo
    const entry=from.current.pop()
    if (!entry) return
    to.current.push({text:current.current,selection:caret.current})
    group.current={type:'',time:0}
    replace(withAttachedImages(entry.text),entry.selection)
  }
  function acceptInput(type:string) {
    if (composing.current) return
    const text=editorText(root.current!)
    const attached=withAttachedImages(text)
    if (attached!==text) {
      remember()
      if (attached!==current.current) record(type)
      replace(attached,caret.current)
      return
    }
    if (text===current.current) return
    record(type)
    remember()
    publish(text)
  }

  useImperativeHandle(props.ref,()=>({
    focus:()=>{root.current?.focus({preventScroll:true});if(root.current)restoreSelection(root.current,caret.current)},
    insertImages:ids=>{if(ids.length)insert(ids.map(imageMention).join(' ')+' ')},
  }))

  useLayoutEffect(()=>{
    const element=root.current!
    if (!composing.current && editorText(element)!==props.value) {
      const focused=document.activeElement===element
      renderEditor(element,props.value,props.inputs)
      // External edits (including successful submission) start a fresh history.
      if (props.value!==current.current) {undo.current=[];redo.current=[];group.current={type:'',time:0}}
      current.current=props.value
      caret.current={start:Math.min(caret.current.start,props.value.length),end:Math.min(caret.current.end,props.value.length)}
      if (focused) restoreSelection(element,caret.current)
    } else updateMentionLabels(element,props.inputs)
  },[props.value,props.inputs])

  useEffect(()=>{
    const element=root.current!
    const changing=()=>remember()
    const input=(event:InputEvent)=>{
      remember()
      before.current=caret.current
      if (event.inputType==='historyUndo'||event.inputType==='historyRedo') {
        event.preventDefault();history(event.inputType==='historyUndo')
      }
    }
    document.addEventListener('selectionchange',changing)
    element.addEventListener('beforeinput',input)
    return ()=>{document.removeEventListener('selectionchange',changing);element.removeEventListener('beforeinput',input)}
  },[])

  return <div ref={root} id="prompt" className="prompt-editor" role="textbox" aria-label="Prompt"
    aria-multiline="true" aria-placeholder={props.placeholder} contentEditable suppressContentEditableWarning
    data-placeholder={props.placeholder} data-empty={!props.value||undefined} spellCheck
    onInput={event=>acceptInput((event.nativeEvent as InputEvent).inputType??'')}
    onCompositionStart={()=>{remember();before.current=caret.current;composing.current=true}}
    onCompositionEnd={()=>{composing.current=false;acceptInput('composition')}}
    onKeyDown={event=>{
      if (event.nativeEvent.isComposing||event.keyCode===229) return
      const modifier=event.metaKey||event.ctrlKey
      if (modifier && event.key.toLowerCase()==='z') {event.preventDefault();history(!event.shiftKey);return}
      if (modifier && event.key.toLowerCase()==='y') {event.preventDefault();history(false);return}
      if (event.key==='Enter') {
        event.preventDefault()
        if (event.shiftKey) insert('\n')
        else if (latest.current.canSubmit&&!event.repeat) latest.current.onSubmit()
      }
    }}
    onPaste={event=>{
      event.preventDefault()
      const text=withAttachedImages(event.clipboardData.getData('text/plain'))
      if (text) insert(text)
    }}
    onCopy={event=>{
      remember()
      const {start,end}=caret.current
      if(start===end)return
      event.preventDefault()
      event.clipboardData.setData('text/plain',resolveImageMentions(current.current.slice(start,end),props.inputs))
    }}
    onCut={event=>{
      remember()
      const {start,end}=caret.current
      if(start===end)return
      event.preventDefault()
      event.clipboardData.setData('text/plain',resolveImageMentions(current.current.slice(start,end),props.inputs))
      insert('')
    }}
    onDrop={event=>event.preventDefault()}/>
}
