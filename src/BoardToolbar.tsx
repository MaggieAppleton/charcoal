import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon.js';
import { BoardIcon } from './board-icons.js';
import type { BoardIconName } from './board-icons.js';
import type { BoardTool } from './board-gestures.js';

export const TOOLS: Array<{ id: BoardTool; label: string; key: string; icon: BoardIconName }> = [
  { id: 'select', label: 'Select', key: 'V', icon: 'cursor' },
  { id: 'hand', label: 'Pan', key: 'H', icon: 'hand' },
  { id: 'pen', label: 'Pen', key: 'P', icon: 'pencil' },
  { id: 'erase', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: 'arrowUpRight' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'square' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'circle' },
  { id: 'note', label: 'Note', key: 'N', icon: 'noteBlank' },
];

type Props = {
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  menu: boolean;
  onMenu: (open: boolean) => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  hasGroup: boolean;
  flattening: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
  onFlatten: () => Promise<void>;
  error: string;
  onDismissError: () => void;
};

export function BoardToolbar(props: Props) {
  const { tool, onTool, menu, onMenu, zoom } = props;
  const rail = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuByKey = useRef(false);
  useEffect(() => {
    if (menu && menuByKey.current) list.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    menuByKey.current = false;
  }, [menu]);

  function choose(id: BoardTool) {
    onTool(id);
    onMenu(false);
  }
  function closeMenu() { onMenu(false); more.current?.focus(); }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && menu) {
      event.stopPropagation();
      closeMenu();
      return;
    }
    const buttons = [...rail.current!.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[(next + buttons.length) % buttons.length].focus();
  }

  const button = (item: typeof TOOLS[number]) => <button type="button" key={item.id} className="btn icon"
    aria-label={item.label} aria-pressed={tool === item.id} aria-keyshortcuts={item.key}
    data-tip={`${item.label} (${item.key})`} data-tip-side="right" tabIndex={tool === item.id ? 0 : -1} onClick={() => choose(item.id)}>
    <BoardIcon name={item.icon} />
  </button>;

  return <div className="board-controls" onKeyDown={keyboard}>
    <div className="board-rail" ref={rail} role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
      {TOOLS.slice(0, -1).map(button)}
      <span className="board-rail-sep" aria-hidden="true" />
      {button(TOOLS.at(-1)!)}
      <button type="button" ref={more} className="btn icon" aria-label="More canvas actions"
        aria-expanded={menu} data-tip={zoom !== 1 ? `More (${Math.round(zoom * 100)}%)` : 'More'} data-tip-side="right"
        tabIndex={-1} onClick={event => { menuByKey.current = event.detail === 0; onMenu(!menu); }}>
        <BoardIcon name="dotsThree" />
      </button>
    </div>
    {menu && <div className="menu board-menu" ref={list} aria-label="More canvas actions">
      {props.hasGroup && <button type="button" aria-busy={props.flattening} disabled={props.flattening}
        onClick={() => void props.onFlatten().then(closeMenu)}>
        {props.flattening ? 'Attaching…' : 'Attach sketch or group'}
      </button>}
      {props.hasGroup && <div className="board-menu-separator" />}
      <button type="button" disabled={!props.canUndo}
        onClick={() => { props.onUndo(); closeMenu(); }}>Undo<kbd>⌘Z</kbd></button>
      <button type="button" disabled={!props.canRedo} aria-keyshortcuts="Meta+Shift+z Control+Shift+z Control+y"
        onClick={() => { props.onRedo(); closeMenu(); }}>Redo<kbd aria-hidden="true">⇧⌘Z</kbd></button>
      <button type="button" onClick={() => props.onZoom(1.25)}>Zoom in<kbd>+</kbd></button>
      <button type="button" onClick={() => props.onZoom(1 / 1.25)}>Zoom out<kbd>−</kbd></button>
      <button type="button" onClick={() => { props.onReset(); closeMenu(); }}>Reset view<kbd>0</kbd></button>
    </div>}
    {props.error && <div className="board-error" role="alert">{props.error}
      <button className="btn icon" aria-label="Dismiss" type="button" onClick={props.onDismissError}><Icon name="x" /></button>
    </div>}
  </div>;
}
