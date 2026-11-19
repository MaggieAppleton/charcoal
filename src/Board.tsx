import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Icon } from './Icon.js';
import { DEFAULT_CAMERA, clamp, imageRects, toScreen, toWorld, zoomAt } from './board-geometry.js';
import type { BoardImage, BoardMark, Camera, Point, Rect } from './board-geometry.js';
import { useBoardGestures } from './board-gestures.js';
import type { BoardPatch, BoardTool } from './board-gestures.js';
import { BoardMarkArt, flattenReference, markRect } from './board-marks.js';
import { BoardToolbar, TOOLS } from './BoardToolbar.js';
import { PendingHalftone } from './PendingHalftone.js';
import './board.css';

type BoardAction = { undo: () => void; redo: () => void };

export type BoardHandle = {
  clientToWorld: (clientX: number, clientY: number) => Point;
  getImageRect: (id: string) => Rect | undefined;
  locate: (id: string) => void;
  focusImage: (id: string) => void;
  focus: () => void;
  recordEdit: (action: BoardAction) => void;
  center: () => Point;
};
type JobCard = { id: string; label: string; status: string; rect: Rect; onOpen: () => void };
type BoardProps = {
  items: BoardImage[];
  positions: Record<string, Rect>;
  deletedImageIds?: string[];
  camera: Camera;
  annotations: BoardMark[];
  attachments: string[];
  active: string | null;
  target: string | null;
  highlighted: string | null;
  disabled?: boolean;
  jobs?: JobCard[];
  onChange: (patch: BoardPatch) => void;
  onToggle: (id: string) => void;
  onActive: (id: string | null) => void;
  onHighlight: (id: string | null) => void;
  onEdit: (id: string) => void;
  onRename: (id: string, trigger: HTMLButtonElement) => void;
  onDelete: (ids: string[], annotations?: BoardMark[]) => BoardAction;
  onReview: (id: string) => void;
  onFlatten: (file: File, point: Point) => void | Promise<void>;
  onAttachMany?: (ids: string[]) => void;
};

type BoardStyle = CSSProperties & { [property: `--${string}`]: string | number };
const boxStyle = (rect: Rect): BoardStyle => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

type HistoryPatch = { positions?: Record<string, Rect | undefined>; annotations?: BoardMark[] };
type HistoryEntry = Record<'undo' | 'redo', HistoryPatch | (() => void)>;
const HISTORY_LIMIT = 50;

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(props, ref) {
  const {
    items, positions, deletedImageIds, annotations, attachments, camera, active, target, highlighted, disabled = false, jobs = [],
    onChange, onToggle, onActive, onHighlight, onEdit, onRename, onDelete, onReview, onFlatten,
  } = props;
  const view = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const space = useRef(false);
  const [history, setHistory] = useState<Record<keyof HistoryEntry, HistoryEntry[]>>({ undo: [], redo: [] });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<BoardTool>('select');
  const [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [marks, setMarks] = useState<string[]>([]);
  const [canvasSelection, setCanvasSelection] = useState<Set<string> | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ id: string; text?: string; newMark?: BoardMark } | null>(null);
  const [flattening, setFlattening] = useState(false);
  const [error, setError] = useState('');
  const rects = useMemo(() => {
    const layout = size.width ? imageRects(items, positions, size.width) : { ...positions };
    for (const id of deletedImageIds ?? []) delete layout[id];
    return layout;
  }, [items, positions, size.width, deletedImageIds]);

  useLayoutEffect(() => {
    const node = view.current!;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function remember(entry: HistoryEntry) {
    setHistory(previous => ({ undo: [...previous.undo.slice(1 - HISTORY_LIMIT), entry], redo: [] }));
  }

  function commit(patch: BoardPatch) {
    const previous: HistoryPatch = {};
    if (patch.annotations) previous.annotations = annotations;
    if (patch.positions) {
      previous.positions = Object.fromEntries(Object.keys(patch.positions).map(id => [id, positions[id]]));
    }
    if (previous.annotations || previous.positions) {
      remember({ undo: previous, redo: { positions: patch.positions, annotations: patch.annotations } });
    }
    if (patch.positions) onChange({ ...patch, positions: { ...positions, ...patch.positions } });
    else onChange(patch);
  }

  function replay(direction: keyof HistoryEntry) {
    const entry = history[direction].at(-1);
    if (!entry) return;
    const opposite = direction === 'undo' ? 'redo' : 'undo';
    setHistory({
      ...history,
      [direction]: history[direction].slice(0, -1),
      [opposite]: [...history[opposite], entry],
    });

    const change = entry[direction];
    if (typeof change === 'function') {
      view.current?.focus({ preventScroll: true });
      change();
      return;
    }
    const patch: BoardPatch = {};
    if (change.positions) {
      const restored = { ...positions };
      for (const [id, rect] of Object.entries(change.positions)) {
        if (rect) restored[id] = rect;
        else delete restored[id];
      }
      patch.positions = restored;
    }
    if (change.annotations) patch.annotations = change.annotations;
    onChange(patch);
  }

  function toggleImage(id: string) {
    const atInputLimit = attachments.length >= 8 && !attachments.includes(id);
    setCanvasSelection(atInputLimit ? new Set([id]) : null);
    onToggle(id);
    if (atInputLimit) {
      setMarks([]);
      onActive(id);
      tiles.current.get(id)?.focus({ preventScroll: true });
    }
  }

  const gesture = useBoardGestures({
    viewport: view, camera, tool, space, marks: annotations, positions: rects,
    attachments, imageSelection: canvasSelection, markSelection: marks,
    onCommit: commit, onToggle: toggleImage, onActive,
    onSelectMarks: ids => {
      setCanvasSelection(null);
      setMarks(ids);
      if (ids.length) view.current?.focus({ preventScroll: true });
    },
    onMarqueeImages: ids => {
      setCanvasSelection(new Set(ids));
      if (ids.length) view.current?.focus({ preventScroll: true });
      const pending = ids.filter(id => !attachments.includes(id)).slice(0, Math.max(0, 8 - attachments.length));
      if (props.onAttachMany) props.onAttachMany(pending);
      else pending.forEach(onToggle);
    },
    onNewNote: mark => { setTool('select'); setNoteDraft({ id: mark.id, newMark: mark }); },
  });
  const displayCamera = gesture.preview.camera ?? camera;
  const boardMarks = gesture.preview.marks ?? annotations;
  const displayMarks = noteDraft?.newMark ? [...boardMarks, noteDraft.newMark] : boardMarks;
  const boardRect = (id: string) => gesture.preview.positions?.[id] ?? rects[id];

  function safeBottom() {
    const node = view.current!;
    const c = node.parentElement?.querySelector('.composer')?.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    return c ? c.top - b.top : b.height;
  }

  function locate(id: string, always = true) {
    const world = rects[id];
    if (!world || !size.width) return;
    const rect = toScreen(world, camera);
    const bottom = safeBottom();
    const dx = rect.width > size.width - 40 ? (size.width - rect.width) / 2 - rect.x
      : clamp(rect.x, 20, size.width - rect.width - 20) - rect.x;
    const dy = rect.height > bottom - 72 ? Math.max(28, (bottom - rect.height) / 2) - rect.y
      : clamp(rect.y, 40, bottom - rect.height - 52) - rect.y;
    if (dx || dy) onChange({ camera: { ...camera, x: camera.x + dx, y: camera.y + dy } });
    if (always) setFlash(id);
  }

  useImperativeHandle(ref, () => ({
    clientToWorld(clientX, clientY) {
      const bounds = view.current!.getBoundingClientRect();
      return toWorld({ x: clientX - bounds.left, y: clientY - bounds.top }, displayCamera);
    },
    getImageRect(id) { return boardRect(id); },
    locate,
    focusImage(id) { tiles.current.get(id)?.focus({ preventScroll: true }); },
    focus() { view.current?.focus({ preventScroll: true }); },
    recordEdit: remember,
    center() { return toWorld({ x: size.width / 2, y: safeBottom() / 2 }, displayCamera); },
  }));

  useLayoutEffect(() => {
    if (disabled || !active || !view.current) return;
    const node = view.current;
    const bar = [...node.querySelectorAll<HTMLElement>('.ctx')].find(el => el.dataset.tile === active);
    if (!bar) return;
    const over = bar.getBoundingClientRect().bottom - node.getBoundingClientRect().top + 12 - safeBottom();
    if (over > 0) onChange({ camera: { ...camera, y: camera.y - over } });
  }, [active, disabled]);

  useEffect(() => {
    if (!flash) return;
    const time = window.setTimeout(() => setFlash(null), 720);
    return () => window.clearTimeout(time);
  }, [flash]);

  const wheelCamera = useRef(camera);
  wheelCamera.current = camera;
  const changeCamera = useRef(onChange);
  changeCamera.current = onChange;
  useEffect(() => {
    const node = view.current!;
    function wheel(event: WheelEvent) {
      if (disabled || (event.target as Element).closest('.board-controls, textarea')) return;
      event.preventDefault();
      const prev = wheelCamera.current;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const bounds = node.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const x = event.deltaX * units, y = event.deltaY * units;
      const next = event.ctrlKey || event.metaKey ? zoomAt(prev, point, prev.zoom * Math.exp(-y * .011))
        : { ...prev, x: prev.x - (event.shiftKey && !x ? y : x), y: prev.y - (event.shiftKey && !x ? 0 : y) };
      wheelCamera.current = next;
      changeCamera.current({ camera: next });
    }
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [disabled]);

  useEffect(() => {
    const clearSpace = () => { space.current = false; };
    window.addEventListener('keyup', clearSpace);
    window.addEventListener('blur', clearSpace);
    return () => {
      window.removeEventListener('keyup', clearSpace);
      window.removeEventListener('blur', clearSpace);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if ((event.target as Element).closest('.board-controls')) return;
      setMenu(false);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menu]);

  function changeZoom(zoom: number) {
    onChange({ camera: zoomAt(camera, { x: size.width / 2, y: safeBottom() / 2 }, zoom) });
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const element = event.target as HTMLElement;
    if (element.closest('textarea,input,[contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (menu) setMenu(false);
      else if (noteDraft) cancelNote();
      else if (tool !== 'select') setTool('select');
      else { setCanvasSelection(null); setMarks([]); onActive(null); }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key === 'z') {
      event.preventDefault();
      replay(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'y') {
      event.preventDefault();
      replay('redo');
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    if ((key === 'delete' || key === 'backspace') && !event.repeat && !event.altKey && !menu) {
      const onCanvas = element === view.current;
      const focusedImage = element.dataset.boardImage ?? element.dataset.boardResize
        ?? element.closest<HTMLElement>('.ctx')?.dataset.tile ?? (onCanvas ? active : null);
      const explicitSelection = onCanvas || focusedImage ? canvasSelection : null;
      const selectedMarks = new Set(onCanvas || explicitSelection || element.closest('.board-mark-selected') ? marks : []);
      const remaining = selectedMarks.size ? annotations.filter(mark => !selectedMarks.has(mark.id)) : annotations;
      const deleteMarks = remaining.length < annotations.length;
      const focusedSelection = !deleteMarks && focusedImage && rects[focusedImage] && attachments.includes(focusedImage);
      const imageIds = Array.from(explicitSelection ?? (focusedSelection ? attachments : [])).filter(id => rects[id]);
      if (imageIds.length || deleteMarks) {
        event.preventDefault();
        remember(onDelete(imageIds, deleteMarks ? remaining : undefined));
        if (deleteMarks) {
          setMarks([]);
          if (noteDraft && selectedMarks.has(noteDraft.id)) setNoteDraft(null);
        }
        view.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (key === ' ' && element === view.current) { event.preventDefault(); space.current = true; return; }
    if (key === '+' || key === '=') { event.preventDefault(); changeZoom(camera.zoom * 1.25); return; }
    if (key === '-') { event.preventDefault(); changeZoom(camera.zoom / 1.25); return; }
    if (key === '0') { event.preventDefault(); onChange({ camera: DEFAULT_CAMERA }); return; }
    const direction = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (direction && !element.closest('button:not([data-board-image], [data-board-resize])')) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 2;
      const [dx, dy] = direction.map(value => value * step);
      const id = element.dataset.boardImage ?? element.dataset.boardResize;
      const rect = id ? rects[id] : undefined;
      if (id && rect) {
        const width = Math.max(32, rect.width + dx + dy);
        const update = event.altKey || element.dataset.boardResize
          ? { ...rect, width, height: rect.height * width / rect.width }
          : { ...rect, x: rect.x + dx, y: rect.y + dy };
        commit({ positions: { [id]: update } });
      } else {
        onChange({ camera: { ...camera, x: camera.x - dx * 10, y: camera.y - dy * 10 } });
      }
      return;
    }
    if (event.altKey) return;
    const choice = TOOLS.find(item => item.key.toLowerCase() === key);
    if (choice) { event.preventDefault(); setTool(choice.id); }
  }

  const selectedImages = items.filter(item => rects[item.id]
    && (canvasSelection ? canvasSelection.has(item.id) : attachments.includes(item.id)));

  async function flatten() {
    if (flattening) return;
    setFlattening(true);
    setError('');
    try {
      const selectedMarks = annotations.filter(mark => marks.includes(mark.id));
      const { file, point } = await flattenReference(selectedImages, rects, selectedMarks);
      await onFlatten(file, point);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The canvas reference could not be attached.');
    } finally {
      setFlattening(false);
    }
  }

  function cancelNote() {
    if (noteDraft?.newMark) setMarks(previous => previous.filter(id => id !== noteDraft.id));
    setNoteDraft(null);
    view.current?.focus({ preventScroll: true });
  }

  function saveNote() {
    if (!noteDraft) return;
    const { id, text, newMark } = noteDraft;
    if (newMark) commit({ annotations: [...annotations, { ...newMark, text }] });
    else if (text !== undefined) commit({ annotations: annotations.map(mark => mark.id === id ? { ...mark, text } : mark) });
    setNoteDraft(null);
    view.current?.focus({ preventScroll: true });
  }

  const hasGroup = annotations.some(mark => marks.includes(mark.id)) || selectedImages.length > 1;
  const surface: BoardStyle = { '--board-width': `${size.width}px`, '--board-height': `${size.height}px` };
  return <div
    ref={view} className="board board-canvas" aria-label="Canvas" role="region" tabIndex={disabled ? -1 : 0}
    inert={disabled || undefined} data-tool={tool} onKeyDown={keyboard} style={surface}
    onPointerDown={event => { if (!(event.target as Element).closest('.board-controls')) gesture.onPointerDown(event); }}
    onPointerMove={gesture.onPointerMove}
    onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel}
    onLostPointerCapture={gesture.onPointerCancel}
  >
    {items.filter(item => boardRect(item.id)).map(item => {
      const rect = toScreen(boardRect(item.id)!, displayCamera);
      const index = attachments.indexOf(item.id);
      const selected = canvasSelection ? canvasSelection.has(item.id) : index >= 0;
      const isActive = item.id === active && !disabled;
      const needsReview = item.needsReview ?? 0;
      const unavailable = item.reviewStatus === 'failed';
      const pending = item.reviewStatus === 'pending';
      const reviewLabel = pending ? 'Checking…' : unavailable ? 'Review unavailable' : needsReview ? `${needsReview} to look at` : 'Checks passed';
      const toolbarHalf = item.candidate ? 143 : 71;
      const ctxLeft = clamp(rect.width / 2, 8 + toolbarHalf - rect.x, size.width - 8 - toolbarHalf - rect.x);
      const label = item.name + (index >= 0 ? `, image ${index + 1}` : '');
      return <div className={`tile board-tile${selected ? ' sel' : ''}${isActive ? ' active' : ''}${highlighted === item.id ? ' hl' : ''}${flash === item.id ? ' flash' : ''}`}
        key={item.id} data-id={item.id} style={boxStyle(rect)}
        onPointerEnter={() => onHighlight(item.id)} onPointerLeave={() => onHighlight(null)}>
        <button type="button" ref={element => { if (element) tiles.current.set(item.id, element); else tiles.current.delete(item.id); }}
          className="board-tile-hit" aria-label={label} data-tip={item.name} aria-pressed={selected} data-board-image={item.id}
          onFocus={event => { if (event.currentTarget.matches(':focus-visible')) locate(item.id, false); }}
          onClick={event => { if (event.detail === 0) toggleImage(item.id); }}>
          <img src={item.url} alt="" draggable={false} />
        </button>
        {index >= 0 && <span className="n" aria-hidden="true">{index + 1}</span>}
        {item.kept ? <span className="mark kept" aria-label="Kept" role="img" data-tip="Kept"><Icon name="check" /></span>
          : item.id === target && item.hasArea && <span className="mark area" aria-label="Has an edit area" role="img" data-tip="Has an edit area"><Icon name="brush" /></span>}
        {item.candidate && !item.seen && <span className="dot" role="img" aria-label="New result" data-tip="New result" />}
        {isActive && <div className="ctx" role="toolbar" aria-label={item.name} data-tile={item.id} style={{ left: ctxLeft }}>
          {item.candidate && <button type="button" className={`btn lead${needsReview || unavailable ? ' warn' : ''}`} onClick={() => onReview(item.id)}>
            <Icon name={pending ? 'doc' : needsReview || unavailable ? 'alertCircle' : 'checkCircle'} />
            {reviewLabel}
          </button>}
          <button type="button" className="btn lead" onClick={() => onEdit(item.id)}>
            <Icon name="brush" />Edit area
          </button>
          <button type="button" className="btn icon" aria-label="Rename image" data-tip="Rename image"
            onClick={event => onRename(item.id, event.currentTarget)}><Icon name="pen" /></button>
        </div>}
        {selected && tool === 'select' && <button type="button" className="board-resize" data-board-resize={item.id} aria-label={`Resize ${item.name}`} data-tip="Resize (arrow keys)" />}
      </div>;
    })}
    {jobs.map(job => {
      const pending = job.status === 'pending';
      return <button type="button" key={job.id} className={pending ? 'board-job board-job-pending' : 'board-job'}
        style={boxStyle(toScreen(job.rect, displayCamera))} title={pending ? undefined : job.status}
        aria-label={pending ? `Pending image: ${job.label}` : undefined} aria-busy={pending || undefined} onClick={job.onOpen}>
        {pending ? <PendingHalftone /> : <><Icon name="doc" /><span>{job.label}</span><small>{job.status}</small></>}
      </button>;
    })}
    <svg className="board-drawings" aria-hidden="true">
      <g transform={`translate(${displayCamera.x},${displayCamera.y}) scale(${displayCamera.zoom})`}>
        {displayMarks.map(mark => <BoardMarkArt mark={mark} key={mark.id} />)}
        {gesture.preview.drawing && <BoardMarkArt mark={gesture.preview.drawing} />}
      </g>
    </svg>
    {displayMarks.map(mark => {
      const selected = marks.includes(mark.id), isNote = mark.kind === 'note';
      if (!(selected || isNote)) return null;
      const rect = toScreen(markRect(mark), displayCamera);
      const editing = noteDraft?.id === mark.id && isNote;
      const showEdit = isNote && selected && !editing
        && rect.x < size.width && rect.x + rect.width > 0 && rect.y < size.height && rect.y + rect.height > 0;
      const style: BoardStyle = {
        ...(!editing && boxStyle(rect)),
        ...(isNote && {
          '--note-x': `${rect.x}px`, '--note-y': `${rect.y}px`,
          '--note-width': `${rect.width}px`, '--note-height': `${rect.height}px`,
        }),
        '--mark-zoom': editing ? clamp(displayCamera.zoom, 1, 1.25) : displayCamera.zoom,
      };
      return <div key={mark.id} className={`board-mark${isNote ? ' board-note' : ''}${selected ? ' board-mark-selected' : ''}${editing ? ' board-note-editing' : ''}`}
        style={style}>
        {isNote && (editing
          ? <textarea aria-label="Note" autoFocus value={noteDraft.text ?? mark.text ?? ''}
            onChange={event => setNoteDraft({ ...noteDraft, text: event.currentTarget.value })}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); cancelNote(); }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveNote();
            }} />
          : <button type="button" className="board-note-text" aria-label={mark.text ? `Note: ${mark.text}` : 'Empty note'}
            onClick={event => {
              if (event.detail === 0) { setMarks([mark.id]); setNoteDraft({ id: mark.id }); }
            }}>{mark.text}</button>)}
        {showEdit && <button type="button" className="btn icon board-note-action" aria-label="Edit note" data-tip="Edit note" onClick={() => setNoteDraft({ id: mark.id })}><Icon name="pen" /></button>}
        {editing && <button type="button" className="btn primary board-note-action" onClick={saveNote}>Done</button>}
      </div>;
    })}
    {gesture.preview.marquee && <div className="board-marquee" style={boxStyle(toScreen(gesture.preview.marquee, displayCamera))} />}
    <BoardToolbar tool={tool} onTool={setTool} menu={menu} onMenu={setMenu}
      zoom={camera.zoom} canUndo={history.undo.length > 0} canRedo={history.redo.length > 0} hasGroup={hasGroup} flattening={flattening}
      onUndo={() => replay('undo')} onRedo={() => replay('redo')}
      onZoom={factor => changeZoom(camera.zoom * factor)} onReset={() => onChange({ camera: DEFAULT_CAMERA })}
      onFlatten={flatten} error={error} onDismissError={() => setError('')} />
  </div>;
});
