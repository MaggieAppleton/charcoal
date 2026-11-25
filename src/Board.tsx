import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Icon } from './Icon.js';
import { DEFAULT_CAMERA, clamp, imageRects, toScreen, toWorld, zoomAt } from './board-geometry.js';
import type { BoardImage, BoardMark, Camera, Point, Rect } from './board-geometry.js';
import { useBoardCamera } from './board-camera.js';
import { useBoardGestures } from './board-gestures.js';
import type { BoardPatch, BoardTool, MarkChanges } from './board-gestures.js';
import { BoardMarkArt, flattenReference, markRect, unionRects } from './board-marks.js';
import { BoardToolbar, TOOLS } from './BoardToolbar.js';
import { PendingHalftone } from './PendingHalftone.js';
import { promptBlockLabel } from './prompt-blocks.js';
import { PinIcon } from './PinnedImages';
import {MetaphorCard, type MetaphorStatus} from './MetaphorCard';
import type {createBoardHistory} from './board-history';
import {metaphorWire} from './metaphor-layout';
import './board.css';

type BoardAction = { undo: () => void; redo: () => void };

export type BoardHandle = {
  clientToWorld: (clientX: number, clientY: number) => Point;
  getImageRect: (id: string) => Rect | undefined;
  locate: (id: string) => void;
  focusImage: (id: string) => void;
  focus: () => void;
  finishWheel: () => void;
  center: () => Point;
  placement: () => {view: Rect; obstacles: Rect[]};
  locateGroup: (ids: string[]) => void;
};
type JobCard = { id: string; label: string; status: string; rect: Rect; onOpen: () => void; onDelete?: () => BoardAction };
type BoardProps = {
  items: BoardImage[];
  positions: Record<string, Rect>;
  deletedImageIds?: string[];
  pinnedIds?: string[];
  onTogglePin?: (id: string) => void;
  onAnnotate?: (id: string) => void;
  camera: Camera;
  annotations: BoardMark[];
  history: ReturnType<typeof createBoardHistory>;
  promptBlockIds?: string[];
  metaphorStatus: Record<string,MetaphorStatus>;
  selectedMetaphor: string | null;
  onSelectMetaphor: (id: string) => void;
  onTogglePromptBlock: (id: string) => void;
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
  onDelete: (ids: string[], markIds: string[]) => BoardAction;
  onReview: (id: string) => void;
  onFlatten: (file: File, point: Point) => void | Promise<void>;
  onAttachMany: (ids: string[]) => void;
  onDetachMany: (ids: string[]) => void;
};

type BoardStyle = CSSProperties & { [property: `--${string}`]: string | number };
const boxStyle = (rect: Rect): BoardStyle => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(props, ref) {
  const {
    items, positions, deletedImageIds, annotations, attachments, camera, active, target, highlighted, disabled = false, jobs = [],
    promptBlockIds, onTogglePromptBlock, pinnedIds = [], onTogglePin, onAnnotate,
    onChange, onToggle, onActive, onHighlight, onEdit, onRename, onDelete, onReview, onFlatten,
  } = props;
  const view = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const navigation = useBoardCamera(view, content, camera, next => onChange({ camera: next }), disabled);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const space = useRef(false);
  const history = useSyncExternalStore(props.history.subscribe, props.history.snapshot);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<BoardTool>('select');
  const [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [marks, setMarks] = useState<string[]>([]);
  const [canvasSelection, setCanvasSelection] = useState<Set<string>>(() => new Set());
  const [noteDraft, setNoteDraft] = useState<{ id: string; text?: string; newMark?: BoardMark } | null>(null);
  const [flattening, setFlattening] = useState(false);
  const [error, setError] = useState('');
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);
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

  function commit(patch: BoardPatch) {
    const {annotations: nextMarks, ...rest} = patch;
    const previous = {
      positions: patch.positions && Object.fromEntries(Object.keys(patch.positions).map(id => [id, positions[id]])),
      markPoints: patch.markPoints && Object.fromEntries(annotations.filter(mark => patch.markPoints?.[mark.id]).map(mark => [mark.id, mark.points])),
    };
    const markChanges: MarkChanges = new Map();
    const previousMarks: MarkChanges = new Map();
    if (nextMarks) {
      const before = new Map(annotations.map((mark,index) => [mark.id, {mark,index}]));
      const after = new Map(nextMarks.map((mark,index) => [mark.id, {mark,index}]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(id)?.mark === after.get(id)?.mark) continue;
        markChanges.set(id, after.get(id) ?? null);
        previousMarks.set(id, before.get(id) ?? null);
      }
    }
    if (previous.positions || previous.markPoints || nextMarks) {
      props.history.record({
        undo: { ...previous, markChanges: nextMarks ? previousMarks : undefined },
        redo: { positions: patch.positions, markPoints: patch.markPoints, markChanges: nextMarks ? markChanges : undefined },
      });
    }
    onChange({ ...rest, ...(nextMarks && { markChanges }), ...(patch.positions && { positions: { ...positions, ...patch.positions } }) });
  }

  function replay(direction: 'undo'|'redo') {
    const change = props.history.take(direction);
    if (!change) return;
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
    if (change.markChanges) patch.markChanges = change.markChanges;
    if (change.markPoints) patch.markPoints = change.markPoints;
    onChange(patch);
  }

  function selectImage(id: string, additive = false) {
    const next = additive ? new Set(canvasSelection) : new Set<string>();
    if (additive && next.has(id)) next.delete(id);
    else next.add(id);
    setCanvasSelection(next);
    if (!additive) setMarks([]);
    onActive(next.size === 1 ? Array.from(next)[0] : null);
    if (next.has(id)) tiles.current.get(id)?.focus({ preventScroll: true });
  }

  function editNewText(mark: BoardMark) {
    setTool('select');
    setMarks([mark.id]);
    setNoteDraft({ id: mark.id, newMark: mark });
  }

  const gesture = useBoardGestures({
    viewport: view, readCamera: navigation.read, tool, space, marks: annotations, positions: rects,
    onPreviewCamera: navigation.preview, onCommitCamera: navigation.commit,
    imageSelection: canvasSelection, markSelection: marks,
    onCommit: commit, onSelectImage: selectImage, onActive,
    onErase: ids => {
      props.history.record(onDelete([], ids));
      setMarks(selected => selected.filter(id => !ids.includes(id)));
    },
    onSelectMarks: ids => {
      if (ids.length) setCanvasSelection(new Set());
      setMarks(ids);
      if (ids.length) view.current?.focus({ preventScroll: true });
    },
    onMarqueeImages: (ids, additive) => {
      const next = additive ? new Set([...canvasSelection, ...ids]) : new Set(ids);
      setCanvasSelection(next);
      onActive(next.size === 1 ? Array.from(next)[0] : null);
      if (next.size) view.current?.focus({ preventScroll: true });
    },
    onNewText: editNewText,
    onClickMetaphor: props.onSelectMetaphor,
  });
  const boardMarks = gesture.preview.marks ?? annotations;
  const displayMarks = noteDraft?.newMark ? [...boardMarks, noteDraft.newMark] : boardMarks;
  const sources = new Map(displayMarks.filter(mark => mark.metaphor?.kind === 'brief').map(mark => [mark.id, markRect(mark)]));
  const boardRect = (id: string) => gesture.preview.positions?.[id] ?? rects[id];

  function safeBottom() {
    const node = view.current;
    if(!node)return size.height;
    const c = node.parentElement?.querySelector('.composer')?.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    return c ? c.top - b.top : b.height;
  }

  function locate(id: string, always = true) {
    const block = annotations.find(mark => mark.id === id);
    const world = rects[id] ?? (block && markRect(block));
    if (!world || !size.width) return;
    const current = navigation.read();
    const rect = toScreen(world, current);
    const bottom = safeBottom();
    const dx = rect.width > size.width - 40 ? (size.width - rect.width) / 2 - rect.x
      : clamp(rect.x, 20, size.width - rect.width - 20) - rect.x;
    const dy = rect.height > bottom - 72 ? Math.max(28, (bottom - rect.height) / 2) - rect.y
      : clamp(rect.y, 40, bottom - rect.height - 52) - rect.y;
    if (dx || dy) navigation.commit({ ...current, x: current.x + dx, y: current.y + dy });
    if (always) setFlash(id);
  }

  useImperativeHandle(ref, () => ({
    clientToWorld(clientX, clientY) {
      const bounds = view.current!.getBoundingClientRect();
      return toWorld({ x: clientX - bounds.left, y: clientY - bounds.top }, navigation.read());
    },
    getImageRect(id) { return boardRect(id); },
    locate,
    placement() {
      const camera = navigation.read();
      return {
        view: {...toWorld({x: 72, y: 52}, camera), width: Math.max(1,size.width - 96)/camera.zoom,
          height: Math.max(1,safeBottom() - 72)/camera.zoom},
        obstacles: [...Object.values(rects), ...jobs.map(job => job.rect)],
      };
    },
    locateGroup(ids) {
      const bounds = unionRects(annotations.filter(mark => ids.includes(mark.id)).map(markRect));
      if (!bounds) return;
      const width = Math.max(1, size.width - 96), height = Math.max(1, safeBottom() - 76);
      const current = navigation.read();
      const screen = toScreen(bounds, current);
      if (current.zoom >= .8 && screen.x >= 56 && screen.y >= 44 &&
        screen.x + screen.width <= size.width - 12 && screen.y + screen.height <= safeBottom() - 12) return;
      const zoom = clamp(Math.min(1, width/bounds.width, height/bounds.height), .12, 1);
      navigation.commit({zoom, x: 72 + (width-bounds.width*zoom)/2 - bounds.x*zoom,
        y: 52 + (height-bounds.height*zoom)/2 - bounds.y*zoom});
    },
    focusImage(id) { tiles.current.get(id)?.focus({ preventScroll: true }); },
    focus() { view.current?.focus({ preventScroll: true }); },
    finishWheel: navigation.finishWheel,
    center() { return toWorld({ x: size.width / 2, y: safeBottom() / 2 }, navigation.read()); },
  }));

  useLayoutEffect(() => {
    if (disabled || !active || !view.current) return;
    const node = view.current;
    const bar = [...node.querySelectorAll<HTMLElement>('.ctx')].find(el => el.dataset.tile === active);
    if (!bar) return;
    const over = bar.getBoundingClientRect().bottom - node.getBoundingClientRect().top + 12 - safeBottom();
    const current = navigation.read();
    if (over > 0) navigation.commit({ ...current, y: current.y - over });
  }, [active, disabled, size.width, Boolean(onAnnotate), Boolean(onTogglePin)]);

  useEffect(() => {
    if (!flash) return;
    const time = window.setTimeout(() => setFlash(null), 720);
    return () => window.clearTimeout(time);
  }, [flash]);

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
    navigation.commit(zoomAt(navigation.read(), { x: size.width / 2, y: safeBottom() / 2 }, zoom));
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const element = event.target as HTMLElement;
    if (element.closest('textarea,input,[contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (tool === 'prompt' && key === 'enter' && element === view.current) {
      event.preventDefault();
      const point = toWorld({ x: size.width / 2 - 100, y: safeBottom() / 2 - 60 }, navigation.read());
      editNewText({ id: crypto.randomUUID(), kind: 'prompt', points: [point] });
      return;
    }
    if (key === 'escape') {
      if (menu) setMenu(false);
      else if (noteDraft) cancelNote();
      else if (tool !== 'select') setTool('select');
      else { setCanvasSelection(new Set()); setMarks([]); onActive(null); }
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
      const jobId = element.closest<HTMLElement>('[data-board-job]')?.dataset.boardJob;
      if (jobId) {
        event.preventDefault();
        const job = jobs.find(job => job.id === jobId);
        if (job) deleteJob(job);
        return;
      }
      const selectedMarks = new Set(marks);
      const markIds = annotations.filter(mark => selectedMarks.has(mark.id)).map(mark => mark.id);
      const imageIds = [...canvasSelection].filter(id => rects[id]);
      if (imageIds.length || markIds.length) {
        event.preventDefault();
        props.history.record(onDelete(imageIds, markIds));
        if (imageIds.length) setCanvasSelection(new Set());
        if (markIds.length) {
          setMarks([]);
          if (noteDraft && selectedMarks.has(noteDraft.id)) setNoteDraft(null);
        }
        view.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (key === ' ' && element === view.current) { event.preventDefault(); space.current = true; return; }
    if (key === '+' || key === '=') { event.preventDefault(); changeZoom(navigation.read().zoom * 1.25); return; }
    if (key === '-') { event.preventDefault(); changeZoom(navigation.read().zoom / 1.25); return; }
    if (key === '0') { event.preventDefault(); navigation.commit(DEFAULT_CAMERA); return; }
    const direction = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (direction && !element.closest('button:not([data-board-image], [data-board-resize], [data-board-metaphor])')) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 2;
      const [dx, dy] = direction.map(value => value * step);
      const metaphor = annotations.find(mark => mark.id === element.dataset.boardMetaphor);
      if (metaphor) {
        commit({ markPoints: { [metaphor.id]: metaphor.points.map(point => ({x:point.x+dx,y:point.y+dy})) } });
        return;
      }
      const id = element.dataset.boardImage ?? element.dataset.boardResize;
      const rect = id ? rects[id] : undefined;
      if (id && rect) {
        const width = Math.max(32, rect.width + dx + dy);
        const update = event.altKey || element.dataset.boardResize
          ? { ...rect, width, height: rect.height * width / rect.width }
          : { ...rect, x: rect.x + dx, y: rect.y + dy };
        commit({ positions: { [id]: update } });
      } else {
        const current = navigation.read();
        navigation.commit({ ...current, x: current.x - dx * 10, y: current.y - dy * 10 });
      }
      return;
    }
    if (event.altKey) return;
    const choice = TOOLS.find(item => item.key.toLowerCase() === key);
    if (choice) { event.preventDefault(); setTool(choice.id); }
  }

  function deleteJob(job: JobCard) {
    if (!job.onDelete) return;
    props.history.record(job.onDelete());
    view.current?.focus({ preventScroll: true });
  }

  const selectedImages = useMemo(
    () => items.filter(item => rects[item.id] && canvasSelection.has(item.id)),
    [items, rects, canvasSelection],
  );
  const selectedIds = selectedImages.map(item => item.id);
  const unattachedSelected = selectedIds.filter(id => !attachments.includes(id));
  const groupBounds = useMemo(() => {
    if (selectedImages.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of selectedImages) {
      const world = boardRect(item.id);
      if (!world) continue;
      const r = toScreen(world, camera);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }, [selectedImages, camera, rects, gesture.preview.positions]);

  const visualMarks = annotations.filter(mark => !mark.metaphor && mark.kind !== 'prompt' && marks.includes(mark.id));

  async function flatten() {
    if (flattening) return;
    setFlattening(true);
    setError('');
    try {
      const { file, point } = await flattenReference(selectedImages, rects, visualMarks);
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

  const editedMark = noteDraft?.newMark ?? annotations.find(mark => mark.id === noteDraft?.id);
  const emptyPromptBlock = editedMark?.kind === 'prompt' && !(noteDraft?.text ?? editedMark.text)?.trim();

  function saveNote() {
    if (!noteDraft || emptyPromptBlock) return;
    const { id, text, newMark } = noteDraft;
    if (newMark) commit({ annotations: [...annotations, { ...newMark, text }] });
    else if (text !== undefined) commit({ annotations: annotations.map(mark => mark.id === id ? { ...mark, text } : mark) });
    setNoteDraft(null);
    view.current?.focus({ preventScroll: true });
  }

  const hasGroup = visualMarks.length > 0 || selectedImages.length > 1;
  const surface: BoardStyle = { '--board-width': `${size.width}px`, '--board-height': `${size.height}px` };
  return <div
    ref={view} className="board board-canvas" aria-label="Canvas" role="region" tabIndex={disabled ? -1 : 0}
    inert={disabled || undefined} data-tool={tool} onKeyDown={keyboard} style={surface}
    onPointerDown={event => {
      navigation.finishWheel();
      if (!(event.target as Element).closest('.board-controls')) gesture.onPointerDown(event);
    }}
    onPointerMove={gesture.onPointerMove}
    onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel}
    onLostPointerCapture={gesture.onPointerCancel}
  >
    <div className="board-content" ref={content}>
    {items.filter(item => boardRect(item.id)).map(item => {
      const rect = toScreen(boardRect(item.id)!, camera);
      const index = attachments.indexOf(item.id);
      const inPrompt = index >= 0;
      const selected = canvasSelection.has(item.id);
      const isActive = item.id === active && selected && selectedImages.length === 1 && !disabled;
      const needsReview = item.needsReview ?? 0;
      const unavailable = item.reviewStatus === 'failed';
      const pending = item.reviewStatus === 'pending';
      const reviewLabel = pending ? 'Checking…' : unavailable ? 'Review unavailable' : needsReview ? `${needsReview} to look at` : 'Checks passed';
      const toolbarHalf = Math.min(size.width - 16, (item.candidate ? 286 : 142) + (onAnnotate ? 102 : 0) + (onTogglePin ? 30 : 0)) / 2;
      const ctxLeft = clamp(rect.width / 2, 8 + toolbarHalf - rect.x, size.width - 8 - toolbarHalf - rect.x);
      const label = item.name + (inPrompt ? `, image ${index + 1}` : '');
      return <div className={`tile board-tile${selected ? ' sel' : ''}${isActive ? ' active' : ''}${highlighted === item.id ? ' hl' : ''}${flash === item.id ? ' flash' : ''}`}
        key={item.id} data-id={item.id} style={boxStyle(rect)}
        onPointerEnter={inPrompt ? () => onHighlight(item.id) : undefined}
        onPointerLeave={inPrompt ? () => onHighlight(null) : undefined}>
        <button type="button" ref={element => { if (element) tiles.current.set(item.id, element); else tiles.current.delete(item.id); }}
          className="board-tile-hit" aria-label={label} data-tip={item.name} aria-pressed={selected} data-board-image={item.id}
          onFocus={event => { if (event.currentTarget.matches(':focus-visible')) locate(item.id, false); }}
          onClick={event => { if (event.detail === 0) selectImage(item.id, event.shiftKey); }}>
          <img src={item.url} alt="" draggable={false} decoding="async" />
        </button>
        {inPrompt && (tool === 'select'
          ? <button type="button" className="n board-prompt-index" tabIndex={-1}
            aria-label={`Remove prompt image ${index + 1}`} data-tip="Remove from prompt"
            onClick={() => onToggle(item.id)}>{index + 1}</button>
          : <span className="n" aria-hidden="true">{index + 1}</span>)}
        {tool === 'select' && <button type="button"
          className={`board-prompt-toggle${inPrompt ? ' attached' : ''}`}
          aria-label={inPrompt ? `Remove ${item.name} from prompt` : `Add ${item.name} to prompt`}
          aria-pressed={inPrompt}
          data-tip={inPrompt ? 'Remove from prompt' : 'Add to prompt'}
          onClick={() => onToggle(item.id)}>
          <Icon name={inPrompt ? 'check' : 'plus'} />
        </button>}
        {item.kept ? <span className="mark kept" aria-label="Kept" role="img" data-tip="Kept"><Icon name="check" /></span>
          : item.id === target && item.hasArea && <span className="mark area" aria-label="Has an edit area" role="img" data-tip="Has an edit area"><Icon name="brush" /></span>}
        {item.candidate && !item.seen && <span className="dot" role="img" aria-label="New result" data-tip="New result" />}
        {pinned.has(item.id) && <span className="board-pinned-mark" role="img" aria-label="Pinned" data-tip="Pinned"><PinIcon /></span>}
        {isActive && <div className="ctx image-actions" role="toolbar" aria-label={item.name} data-tile={item.id} style={{ left: ctxLeft, maxWidth: Math.max(0, size.width - 16) }}>
          {item.candidate && <button type="button" className={`btn lead${needsReview || unavailable ? ' warn' : ''}`} onClick={() => onReview(item.id)}>
            <Icon name={pending ? 'doc' : needsReview || unavailable ? 'alertCircle' : 'checkCircle'} />
            {reviewLabel}
          </button>}
          <button type="button" className="btn lead" onClick={() => onEdit(item.id)}>
            <Icon name="brush" />Edit area
          </button>
          {onAnnotate && <button type="button" className="btn lead" onClick={() => onAnnotate(item.id)}>
            <Icon name="pen" />Annotate
          </button>}
          {onTogglePin && <button type="button" className="btn icon" aria-pressed={pinned.has(item.id)}
            aria-label={`${pinned.has(item.id) ? 'Unpin' : 'Pin'} ${item.name}`} data-tip={pinned.has(item.id) ? 'Unpin image' : 'Pin image'}
            onClick={() => onTogglePin(item.id)}><PinIcon /></button>}
          <button type="button" className="btn icon" aria-label="Rename image" data-tip="Rename image"
            onClick={event => onRename(item.id, event.currentTarget)}><Icon name="pen" /></button>
        </div>}
        {selected && tool === 'select' && <button type="button" className="board-resize" data-board-resize={item.id} aria-label={`Resize ${item.name}`} data-tip="Resize (arrow keys)" />}
      </div>;
    })}
    {jobs.map(job => {
      const pending = job.status === 'pending';
      return <div key={job.id} className="board-job-tile" data-board-job={job.id} style={boxStyle(toScreen(job.rect, camera))}>
        <button type="button" className={pending ? 'board-job board-job-pending' : 'board-job'} title={pending ? undefined : job.status}
        aria-label={pending ? `Pending image: ${job.label}` : undefined} aria-busy={pending || undefined} onClick={job.onOpen}>
        {pending ? <PendingHalftone /> : <><Icon name="doc" /><span>{job.label}</span><small>{job.status}</small></>}
        </button>
        {job.onDelete && <button type="button" className="btn icon board-job-delete" aria-label={`Remove ${job.label} from canvas`}
          data-tip="Remove from canvas (⌫)" onClick={() => deleteJob(job)}><Icon name="trash" /></button>}
      </div>;
    })}
    <svg className="board-drawings" aria-hidden="true">
      <g transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}>
        {displayMarks.map(mark => {
          const sourceId = mark.metaphor?.briefId;
          const source = sourceId && sources.get(sourceId);
          return source && <path key={mark.id} className="metaphor-wire" data-metaphor-wire={mark.id}
            data-selected={props.selectedMetaphor === mark.id || props.selectedMetaphor === sourceId || undefined}
            d={metaphorWire(source, markRect(mark))}/>;
        })}
        {displayMarks.map(mark => <BoardMarkArt mark={mark} key={mark.id} />)}
        {gesture.preview.drawing && <BoardMarkArt mark={gesture.preview.drawing} />}
      </g>
    </svg>
    {displayMarks.map(mark => {
      if (mark.metaphor) {
        const bounds = markRect(mark);
        const rect = toScreen(bounds, camera);
        const selected = props.selectedMetaphor === mark.id || marks.includes(mark.id);
        return <div key={mark.id} className="board-mark metaphor-canvas-card"
          data-metaphor-id={mark.id} data-metaphor-kind={mark.metaphor.kind}
          style={{...boxStyle(rect),width:bounds.width,height:bounds.height,transform:`scale(${camera.zoom})`}}>
          <MetaphorCard id={mark.id} data={mark.metaphor} selected={selected}
            status={props.metaphorStatus[mark.id]} onOpen={() => {
              setMarks([mark.id]); setCanvasSelection(new Set()); onActive(null); props.onSelectMetaphor(mark.id);
            }}/>
        </div>;
      }
      const isPrompt = mark.kind === 'prompt';
      const selected = marks.includes(mark.id), isNote = mark.kind === 'note' || isPrompt;
      const linked = isPrompt && !!promptBlockIds?.includes(mark.id);
      const textLabel = isPrompt ? `Prompt block: ${promptBlockLabel(mark.text ?? '')}`
        : mark.text ? `Note: ${mark.text}` : 'Empty note';
      if (!(selected || isNote)) return null;
      const rect = toScreen(markRect(mark), camera);
      const editing = noteDraft?.id === mark.id && isNote;
      const showEdit = isNote && selected && !editing
        && rect.x < size.width && rect.x + rect.width > 0 && rect.y < size.height && rect.y + rect.height > 0;
      const style: BoardStyle = {
        ...(!editing && boxStyle(rect)),
        ...(isNote && {
          '--note-x': `${rect.x}px`, '--note-y': `${rect.y}px`,
          '--note-width': `${rect.width}px`, '--note-height': `${rect.height}px`,
        }),
        '--mark-zoom': editing ? clamp(camera.zoom, 1, 1.25) : camera.zoom,
      };
      return <div key={mark.id} className={`board-mark${isNote ? ' board-note' : ''}${selected ? ' board-mark-selected' : ''}${editing ? ' board-note-editing' : ''}${isPrompt ? ' board-prompt-block' : ''}${flash === mark.id ? ' flash' : ''}`}
        style={style}
        onDoubleClick={isPrompt && tool === 'select' && !editing ? () => {
          setMarks([mark.id]); setNoteDraft({ id: mark.id });
        } : undefined}>
        {isNote && (editing
          ? <textarea aria-label={isPrompt ? "Prompt text" : "Note"} autoFocus value={noteDraft.text ?? mark.text ?? ''}
            onChange={event => setNoteDraft({ ...noteDraft, text: event.currentTarget.value })}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); cancelNote(); }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveNote();
            }} />
          : <button type="button" className="board-note-text" aria-label={textLabel}
            onFocus={isPrompt ? event => {
              if (event.currentTarget.matches(':focus-visible')) locate(mark.id, false);
            } : undefined}
            onClick={event => {
              if (event.detail === 0) { setMarks([mark.id]); setNoteDraft({ id: mark.id }); }
            }}>{mark.text}</button>)}
        {isPrompt && !editing && (tool === 'select' || linked) && <button type="button"
          className={`board-prompt-toggle${linked ? ' attached' : ''}`}
          aria-label={linked ? 'Remove from prompt' : 'Add to prompt'}
          data-tip={linked ? 'Remove from prompt' : 'Add to prompt'}
          aria-pressed={linked} onDoubleClick={event => event.stopPropagation()}
          onClick={() => onTogglePromptBlock(mark.id)}><Icon name={linked ? 'check' : 'plus'} /></button>}
        {showEdit && <button type="button" className="btn icon board-note-action"
          aria-label={isPrompt ? `Edit prompt block: ${promptBlockLabel(mark.text ?? '')}` : 'Edit note'}
          data-tip={isPrompt ? 'Edit prompt block' : 'Edit note'}
          onClick={() => setNoteDraft({ id: mark.id })}><Icon name="pen" /></button>}
        {editing && <button type="button" className="btn primary board-note-action" disabled={emptyPromptBlock} onClick={saveNote}>Done</button>}
      </div>;
    })}
    {groupBounds && tool === "select" && !disabled && !gesture.preview.positions && <div
      className="ctx board-group-ctx"
      role="toolbar"
      aria-label={`${selectedImages.length} selected images`}
      style={{
        left: clamp(groupBounds.maxX, 180, Math.max(180, size.width - 12)),
        top: clamp(groupBounds.minY - 8, 56, Math.max(56, size.height - 96)),
      }}>
      {unattachedSelected.length > 0 ? <button type="button" className="btn lead"
        onClick={() => props.onAttachMany(unattachedSelected)}>
        <Icon name="plus" />Add to prompt
      </button> : <button type="button" className="btn lead" onClick={() => props.onDetachMany(selectedIds)}>
        <Icon name="x" />Remove from prompt
      </button>}
    </div>}
    {gesture.preview.marquee && <div className="board-marquee" style={boxStyle(toScreen(gesture.preview.marquee, camera))} />}
    </div>
    <BoardToolbar tool={tool} onTool={setTool} menu={menu} onMenu={setMenu}
      zoom={camera.zoom} canUndo={history.undo.length > 0} canRedo={history.redo.length > 0} hasGroup={hasGroup} flattening={flattening}
      onUndo={() => replay('undo')} onRedo={() => replay('redo')}
      onZoom={factor => changeZoom(navigation.read().zoom * factor)} onReset={() => navigation.commit(DEFAULT_CAMERA)}
      onFlatten={flatten} error={error} onDismissError={() => setError('')} />
  </div>;
});
