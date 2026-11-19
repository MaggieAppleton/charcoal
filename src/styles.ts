export const MAX_STYLE_RULES = 50
export const MAX_RULE_EXAMPLES = 16

export const exampleKinds = ['Like this', 'Not this', 'Focal area'] as const
export type ExampleKind = typeof exampleKinds[number]
export type Example = {
  id: string
  kind: ExampleKind
  area?: [number, number, number, number]
}

export type Rule = {
  id: string
  title: string
  on: boolean
  prompt: string
  check: string
  ex: Example[]
}

export type StyleVersion = { name: string; version: number; rules: Rule[] }
export type Style = StyleVersion & { id: string; dirty: boolean; history: StyleVersion[]; archived?: boolean }
export type StyleStore = {
  activeId: string | null
  styles: Style[]
  overrides: Record<string, boolean>
}

export function emptyStyleStore(): StyleStore {
  return { activeId: null, styles: [], overrides: {} }
}

export function demoStyleStore(): StyleStore {
  const version: StyleVersion = {
    name: 'Field notes',
    version: 3,
    rules: [
      {
        id: 'fig', title: 'Figure shapes', on: true,
        prompt: 'Build figures from a rounded head, a wedge torso and two clear limb shapes.',
        check: 'Head, torso and limbs read as separate shapes at thumbnail size.',
        ex: [{ id: 'walkers', kind: 'Like this' }],
      },
      {
        id: 'grain', title: 'Dry ink grain', on: true,
        prompt: 'Use dry ink grain inside filled shapes. Leave open paper clear.',
        check: '',
        ex: [{ id: 'grain', kind: 'Like this' }],
      },
      {
        id: 'quiet', title: 'Quiet background', on: true,
        prompt: 'Keep background foliage to a few broad silhouettes.',
        check: 'Outside the main figure, foliage reads as broad silhouettes with no inner linework.',
        ex: [{ id: 's2', kind: 'Like this' }, { id: 's1', kind: 'Not this' }],
      },
      {
        id: 'contrast', title: 'Focal contrast', on: true,
        prompt: '',
        check: 'The strongest light–dark edge sits on the main figure or what they hold.',
        ex: [],
      },
      {
        id: 'margin', title: 'Headline space', on: false,
        prompt: 'Leave open paper across the top third for a headline.',
        check: 'The top third has no figures or dense marks.',
        ex: [],
      },
    ],
  }
  return {
    activeId: 'field-notes',
    styles: [{ ...version, id: 'field-notes', dirty: false, history: [structuredClone(version)] }],
    overrides: {},
  }
}

export function activeStyle(store: StyleStore) {
  return store.styles.find(style => !style.archived && style.id === store.activeId)
}

export function effectiveRules(store: StyleStore) {
  return activeStyle(store)?.rules.filter(rule =>
    Object.hasOwn(store.overrides, rule.id) ? store.overrides[rule.id] : rule.on) ?? []
}

export function saveStyleVersion(style: Style): Style {
  if (!style.dirty) return style
  const version = style.version + 1
  const name = style.name.trim() || 'Untitled style'
  const snapshot = structuredClone({ name, version, rules: style.rules })
  return { ...style, name, version, dirty: false, history: [...style.history, snapshot] }
}
