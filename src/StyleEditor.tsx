import { Accordion } from '@base-ui/react/accordion'
import { Menu } from '@base-ui/react/menu'
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon.js'
import type { Asset } from './model'
import { ExampleFigure, ExampleList } from './StyleExamples'
import {
  activeStyle, MAX_STYLE_RULES, saveStyleVersion,
  type Rule, type Style, type StyleStore, type StyleVersion,
} from './styles'

type StyleEditorProps = {
  store: StyleStore
  assets: Asset[]
  attachments: string[]
  onChange: (store: StyleStore) => void
  onImportExamples: (files: File[]) => Promise<Asset[]>
}

type View = 'rules' | 'history' | 'overrides' | 'archive'

export function StyleEditor({ store, assets, attachments, onChange, onImportExamples }: StyleEditorProps) {
  const style = activeStyle(store)
  const [openRule, setOpenRule] = useState<string[]>([])
  const [view, setView] = useState<View>('rules')
  const [rename, setRename] = useState(false)
  const [version, setVersion] = useState<StyleVersion>()
  const nameInput = useRef<HTMLInputElement>(null)
  const switchButton = useRef<HTMLButtonElement>(null)
  const nameToFocus = useRef<string>(null)
  const versionButton = useRef<HTMLButtonElement>(null)
  const savedVersion = useRef(false)
  const viewHeader = useRef<HTMLButtonElement>(null)
  const archiveCancel = useRef<HTMLButtonElement>(null)
  const ruleList = useRef<HTMLDivElement>(null)
  const newRule = useRef<HTMLButtonElement>(null)
  const archivedStyles = store.styles.filter(item => item.archived)

  useLayoutEffect(() => {
    if (rename) {
      nameInput.current?.focus()
      nameInput.current?.select()
    }
  }, [rename, style?.id])

  useLayoutEffect(() => {
    if (view === 'archive') archiveCancel.current?.focus()
    else if (view !== 'rules') viewHeader.current?.focus()
  }, [view, version])

  useLayoutEffect(() => {
    if (savedVersion.current && !style?.dirty) {
      savedVersion.current = false
      versionButton.current?.focus()
    }
  }, [style?.dirty])

  function update(next: Style, overrides = store.overrides) {
    onChange({ ...store, overrides, styles: store.styles.map(item => item.id === next.id ? next : item) })
  }

  function resetView() {
    setView('rules')
    setVersion(undefined)
    setOpenRule([])
    setRename(false)
  }

  function switchStyle(id: string | null) {
    resetView()
    onChange({ ...store, activeId: id, overrides: {} })
  }

  function archiveStyle() {
    if (!style) return
    resetView()
    onChange({
      ...store, activeId: null, overrides: {},
      styles: store.styles.map(item => item.id === style.id ? { ...item, archived: true } : item),
    })
    switchButton.current?.focus()
  }

  function restoreStyle(id: string) {
    onChange({
      ...store, activeId: style?.id ?? id,
      styles: store.styles.map(item => item.id === id ? { ...item, archived: false } : item),
    })
  }

  function createStyle() {
    const next: Style = { id: crypto.randomUUID(), name: 'Untitled style', version: 0, dirty: true, rules: [], history: [] }
    setOpenRule([])
    setView('rules')
    setVersion(undefined)
    setRename(true)
    onChange({ ...store, activeId: next.id, styles: [...store.styles, next], overrides: {} })
  }

  function addRule() {
    if (!style || style.rules.length >= MAX_STYLE_RULES) return
    const rule: Rule = { id: crypto.randomUUID(), title: '', on: true, prompt: '', check: '', ex: [] }
    nameToFocus.current = rule.id
    setOpenRule([rule.id])
    update({ ...style, dirty: true, rules: [...style.rules, rule] })
  }

  function editRule(rule: Rule) {
    if (!style) return
    update({ ...style, dirty: true, rules: style.rules.map(item => item.id === rule.id ? rule : item) })
  }

  function removeRule(id: string) {
    if (!style) return
    const index = style.rules.findIndex(rule => rule.id === id)
    if (index < 0) return
    const neighbor = style.rules[index + 1] ?? style.rules[index - 1]
    const next = neighbor && ruleList.current?.querySelector<HTMLButtonElement>(
      `[data-rule="${CSS.escape(neighbor.id)}"] .rule-trigger`,
    )
    const focusTarget = next || newRule.current
    focusTarget?.focus()
    const overrides = { ...store.overrides }
    delete overrides[id]
    setOpenRule(value => value.filter(ruleId => ruleId !== id))
    update({ ...style, dirty: true, rules: style.rules.filter(rule => rule.id !== id) }, overrides)
  }

  function restoreVersion(snapshot: StyleVersion) {
    if (!style) return
    update({ ...style, name: snapshot.name, rules: structuredClone(snapshot.rules), dirty: true })
    setOpenRule([])
    returnToRules()
  }

  function returnToRules() {
    setView('rules')
    setVersion(undefined)
    requestAnimationFrame(() => versionButton.current?.focus())
  }

  return <>
    <div className="pophead">
      <Menu.Root modal={false}>
        <Menu.Trigger ref={switchButton} className="btn" id="styleSwitch">
          <span className="style-switch-name">{style?.name || 'No style'}</span><Icon name="chevDown" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="style-menu-positioner" align="start" sideOffset={4} collisionPadding={12}>
            <Menu.Popup className="menu style-menu" finalFocus={view === 'archive' ? archiveCancel : undefined}>
              <Menu.RadioGroup value={style?.id ?? ''} onValueChange={value => switchStyle(value || null)}>
                {store.styles.filter(item => !item.archived).map(item => <Menu.RadioItem className="menu-item" key={item.id} value={item.id} closeOnClick>
                  <span className="chk"><Menu.RadioItemIndicator><Icon name="check" /></Menu.RadioItemIndicator></span>
                  <span>{item.name}</span>
                </Menu.RadioItem>)}
                <Menu.RadioItem className="menu-item" value="" closeOnClick>
                  <span className="chk"><Menu.RadioItemIndicator><Icon name="check" /></Menu.RadioItemIndicator></span>
                  <span>No style</span>
                </Menu.RadioItem>
              </Menu.RadioGroup>
              <Menu.Item className="menu-item" onClick={createStyle}>
                <Icon name="plus" /><span>New style</span>
              </Menu.Item>
              {style && <>
                <Menu.Item className="menu-item" onClick={() => { setView('rules'); setRename(true) }}>
                  <Icon name="pen" /><span>Rename style</span>
                </Menu.Item>
                <Menu.Item className="menu-item" onClick={() => setView('overrides')}>
                  <Icon name="sliders" /><span>For this run</span>
                </Menu.Item>
                <Menu.Item className="menu-item" onClick={() => { setRename(false); setView('archive') }}>
                  <Icon name="x" /><span>Archive style</span>
                </Menu.Item>
              </>}
              {archivedStyles.length > 0 && <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className="menu-item">
                  <Icon name="doc" /><span>Archived styles</span>
                  <span className="muted style-archive-count">{archivedStyles.length}</span><Icon name="chevRight" />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner className="style-menu-positioner" side="right" align="start" sideOffset={4} collisionPadding={12}>
                    <Menu.Popup className="menu style-menu">
                      {archivedStyles.map(item => <Menu.Item className="menu-item" key={item.id}
                        aria-label={`Restore ${item.name}`} onClick={() => restoreStyle(item.id)}>
                        <Icon name="undo" /><span className="style-archived-name">{item.name}</span><span className="muted">Restore</span>
                      </Menu.Item>)}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {style && <>
        <button type="button" ref={versionButton} className="link style-version" aria-label="Version history"
          aria-expanded={view === 'history'} onClick={() => {
            if (view === 'history') returnToRules()
            else { setView('history'); setVersion(undefined) }
          }}>{style.version ? `Version ${style.version}${style.dirty ? ', edited' : ''}` : 'Draft'}</button>
        <span className="spacer" />
        {style.dirty && <button id="saveStyle" type="button" className="btn primary" onClick={() => {
          savedVersion.current = true
          update(saveStyleVersion(style))
        }}>Save as version {style.version + 1}</button>}
      </>}
    </div>
    {!style && <p className="muted style-message">Your prompt goes to Sunburst as written, with no checks afterwards.</p>}
    {style && view === 'archive' && <div className="style-archive" role="group" aria-label="Archive style">
      <p>Archive <strong>{style.name}</strong>?</p>
      <div>
        <button type="button" className="btn primary" onClick={archiveStyle}>Archive style</button>
        <button type="button" className="btn" ref={archiveCancel} onClick={() => {
          setView('rules')
          switchButton.current?.focus()
        }}>Cancel</button>
      </div>
    </div>}
    {style && rename && <form key={style.id} className="style-rename" onSubmit={event => {
      event.preventDefault()
      const name = nameInput.current?.value.trim()
      if (!name) return
      if (name !== style.name) update({ ...style, name, dirty: true })
      setRename(false)
      switchButton.current?.focus()
    }}>
      <input ref={nameInput} defaultValue={style.name} type="text" required aria-label="Style name" />
      <button type="submit" className="btn">Done</button>
      <button type="button" className="btn icon" aria-label="Cancel rename" data-tip="Cancel rename" onClick={() => {
        setRename(false)
        switchButton.current?.focus()
      }}><Icon name="x" /></button>
    </form>}
    {style && view === 'rules' && <>
      <Accordion.Root ref={ruleList} value={openRule} onValueChange={setOpenRule}>
        {style.rules.map(rule => <Accordion.Item className={`rule${rule.on ? '' : ' off'}`} value={rule.id} key={rule.id} data-rule={rule.id}>
          <div className="rrow">
            <input type="checkbox" className="check" checked={rule.on}
              aria-label={`Use ${rule.title || 'untitled rule'}`} data-tip={rule.on ? 'On for this style' : 'Off'}
              onChange={event => editRule({ ...rule, on: event.target.checked })} />
            <Accordion.Header>
              <Accordion.Trigger className="rule-trigger" aria-label={rule.title || 'Untitled rule'} data-tip={rule.title}>
                <span className="t">{rule.title || <span className="muted">Untitled rule</span>}</span>
                <span className="kinds" aria-hidden="true">
                  <span className={rule.prompt.trim() ? 'on' : ''} data-tip={rule.prompt.trim() ? 'Adds to the prompt' : 'Adds nothing to the prompt'}><Icon name="lines" /></span>
                  <span className={rule.check.trim() ? 'on' : ''} data-tip={rule.check.trim() ? 'Checks each result' : 'No check'}><Icon name="eye" /></span>
                </span>
                <span className="chev"><Icon name="chevRight" /></span>
              </Accordion.Trigger>
            </Accordion.Header>
          </div>
          <Accordion.Panel className="rule-panel">
            <RuleFields key={rule.id} rule={rule} assets={assets} attachments={attachments}
              onChange={editRule} onRemove={() => removeRule(rule.id)} onImportExamples={onImportExamples}
              focusName={nameToFocus.current === rule.id ? input => {
                nameToFocus.current = null
                input.focus()
              } : undefined} />
          </Accordion.Panel>
        </Accordion.Item>)}
      </Accordion.Root>
      <button type="button" ref={newRule} className="btn lead new-rule" id="addRule" onClick={addRule}
        disabled={style.rules.length >= MAX_STYLE_RULES}><Icon name="plus" />New rule</button>
      {style.rules.length >= MAX_STYLE_RULES && <span className="limit">{MAX_STYLE_RULES} rules at most.</span>}
    </>}
    {style && (view === 'history' || view === 'overrides') && <>
      <button type="button" className="btn" ref={viewHeader} onClick={() => {
        if (version) setVersion(undefined)
        else returnToRules()
      }}>Back to {version ? 'version history' : 'rules'}</button>
      {view === 'overrides' && <>
        {style.rules.map(rule => <label key={rule.id} className="style-list-row">
          <span>{rule.title || 'Untitled rule'}</span>
          <input type="checkbox" className="check" checked={store.overrides[rule.id] ?? rule.on}
            onChange={event => {
              const overrides = { ...store.overrides }
              if (event.target.checked === rule.on) delete overrides[rule.id]
              else overrides[rule.id] = event.target.checked
              onChange({ ...store, overrides })
            }} />
        </label>)}
        {Object.keys(store.overrides).length > 0 && <button type="button" className="btn" onClick={() => onChange({ ...store, overrides: {} })}>Reset overrides</button>}
      </>}
      {view === 'history' && (version
        ? <div className="style-version-view">
          <div className="style-list-row"><strong>{version.name}</strong><span className="muted">Version {version.version}</span></div>
          {version.rules.map(rule => <section key={rule.id} className="style-list-row">
            <div><strong>{rule.title || 'Untitled rule'}</strong>
              {!rule.on && <span className="muted"> (Off)</span>}
              {rule.prompt && <p>{rule.prompt}</p>}
              {rule.check && <p className="muted">{rule.check}</p>}
              {rule.ex.length > 0 && <div className="exs">
                {rule.ex.map(example => <ExampleFigure key={example.id} example={example}
                  asset={assets.find(asset => asset.id === example.id)} />)}
              </div>}
            </div>
          </section>)}
          {(style.dirty || version.version !== style.version) && <button type="button" className="btn" onClick={() => restoreVersion(version)}>Restore as draft</button>}
        </div>
        : [...style.history].reverse().map(item => <button type="button" className="btn style-history-row" key={item.version}
          onClick={() => setVersion(item)}>Version {item.version} <span className="muted">{item.name}</span><Icon name="chevRight" /></button>))}
    </>}
  </>
}

type RuleFieldsProps = Pick<StyleEditorProps, 'assets' | 'attachments' | 'onImportExamples'> & {
  rule: Rule
  onChange: (rule: Rule) => void
  onRemove: () => void
  focusName?: (input: HTMLInputElement) => void
}

function RuleFields({ rule, assets, attachments, onChange, onRemove, focusName, onImportExamples }: RuleFieldsProps) {
  return <div className="rbody">
    <label><span className="field-l">Name</span><input ref={input => { if (input) focusName?.(input) }}
      type="text" value={rule.title} onChange={event => onChange({ ...rule, title: event.target.value })} /></label>
    <label><span className="field-l">Adds to the prompt</span><textarea rows={2}
      placeholder="Words Sunburst gets with every request" value={rule.prompt}
      onChange={event => onChange({ ...rule, prompt: event.target.value })} /></label>
    <label><span className="field-l">Looks for in each result</span><textarea rows={2}
      placeholder="What a passing image shows" value={rule.check}
      onChange={event => onChange({ ...rule, check: event.target.value })} /></label>
    <ExampleList rule={rule} assets={assets} attachments={attachments} onChange={onChange}
      onImportExamples={onImportExamples} />
    <button type="button" className="btn lead rule-remove" onClick={onRemove}><Icon name="trash" />Remove rule</button>
  </div>
}
