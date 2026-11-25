import type { BoardMark, Camera, Rect } from './board-geometry'
import type { StyleStore } from './styles'

export type Asset = {
  id: string
  name: string
  width: number
  height: number
  url: string
  originalUrl: string
}

type Level = 'Low' | 'Medium' | 'High'
export type Settings = {
  quality: Level
  complexity: Level
  size: 'Wide' | 'Square' | 'Tall'
  count: '1' | '2' | '3' | '4'
}

export {SIZES} from './request.js'
export const DEFAULT_SETTINGS: Settings = {quality: 'Medium', complexity: 'Low', size: 'Wide', count: '4'}

export type GuideMode = 'whole' | 'mask' | 'markup'
export type GuideLayer = 'area' | 'sketch'
export type Guide = {
  tool?: 'pen' | 'arrow' | 'rectangle' | 'text'
  text?: string
  layer: GuideLayer
  size: number
  erase?: boolean
  fill?: boolean
  pts: [number, number][]
}

export type PromptPart = {kind: 'img' | 'you' | 'sty'; text: string; title?: string}
export type PromptBlock = {id: string; text: string}
export type ReferenceRole = 'composition' | 'colour' | 'lighting' | 'texture' | 'style' | 'subject'
export type ReferenceDirection = {roles: ReferenceRole[]; use: string; avoid: string}
export type StudyMode = 'illustration' | 'composition' | 'lighting' | 'colour' | 'texture'
export type VariationAxis = 'composition' | 'colour' | 'style' | 'lighting' | 'freeform'
export type Workspace = {
  inlineReferencesVersion?: 1
  referenceDirections?: Record<string, ReferenceDirection>
  studyMode?: StudyMode
  variationAxis?: VariationAxis
  studyDirections?: string[]
  pinnedIds?: string[]
  runBriefs?: Record<string, {prompt: string; referenceDirections: Record<string, ReferenceDirection>}>
  pendingSubmission?: {fingerprint: string; ids: string[]; recoveryOnly?: boolean}
  prompt: string
  metaphorDraft?: {context: string; briefId?: string; article?: import('./MetaphorCard').ArticleSource}
  promptBlockIds?: string[]
  settings: Settings
  styleStore: StyleStore
  imageIds: string[]
  // Canvas visibility only. Runs and libraries continue to reference the asset.
  deletedImageIds?: string[]
  deletedRunIds?: string[]
  referenceIds?: string[]
  attachments: string[]
  active: string | null
  target: string | null
  guideMode: GuideMode
  guides: Record<string, Guide[]>
  positions: Record<string, Rect>
  camera: Camera
  annotations: BoardMark[]
}

export type Check = {
  id: string
  title: string
  status: 'pass' | 'warn' | 'fail'
  obs: string
  loc?: [number, number, number, number] | 'area'
  revise?: string
  override?: string
}

export type Candidate = {
  id: string
  rawId: string
  checks: Check[]
  reviewStatus: 'pending' | 'done' | 'failed'
  reviewError?: string
  kept?: boolean
  seen?: boolean
  createdAt?: string
}

export type Run = {
  id: string
  label: string
  prompt: string
  effectivePrompt: string
  inputs: string[]
  target: string | null
  parent: string | null
  guideMode: GuideMode
  guide: Guide[]
  settings: Settings
  style: {
    name: string
    version: number
    rules: StyleStore['styles'][number]['rules']
  } | null
  rect: Rect
  status: 'pending' | 'done' | 'failed' | 'uncertain'
  candidates: Candidate[]
  error?: string
  createdAt: string
  provider: 'fixture' | 'live' | 'unconfigured'
  rawIds?: string[]
  retryNeedsConfirmation?: boolean
  retriedFrom?: string
  reviewer?: {model:string;instruction:string}
  usage?: unknown
}

export type Boot = {
  workspace: Workspace | null
  assets: Asset[]
  runs: Run[]
  demo: boolean
  provider: 'fixture' | 'live' | 'unconfigured'
  sessionKey?: boolean
}
