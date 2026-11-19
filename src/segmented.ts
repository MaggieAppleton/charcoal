import type {KeyboardEvent} from 'react'

export function segmentKeys(event:KeyboardEvent<HTMLElement>) {
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:enabled'))
  const current=buttons.indexOf(event.target as HTMLButtonElement)
  if (current<0||!buttons.length) return
  const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key]
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1
    : step?(current+step+buttons.length)%buttons.length:-1
  if(next<0) return
  event.preventDefault()
  buttons[next].focus()
  buttons[next].click()
}
