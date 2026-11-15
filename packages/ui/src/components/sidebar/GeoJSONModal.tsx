import { useState, useEffect, useCallback, useRef, useContext } from 'react'
import { EventContext } from '../../contexts/EventContext'
import { clipboardErrorEvent } from '../../utils/clipboardError'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'
import { readStorage, writeStorage } from '@element-editor/core'
import { createPortal } from 'react-dom'
import { Copy, Check, DownloadSimple, SidebarSimple, ArrowSquareOut, X, WarningCircle } from '@phosphor-icons/react'
import type { Geometry } from 'geojson'
import type { GeoJSONFeature, Group, Schema } from '@element-editor/core'
import { CloseButton } from '../ui/CloseButton'
import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { Annotation, ChangeSet, EditorState, Compartment, Prec, RangeSetBuilder, StateEffect, StateField, Text, Transaction } from '@codemirror/state'
import { json as jsonLang } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { setDiagnostics, forEachDiagnostic } from '@codemirror/lint'
import { useDragWindow } from '../../hooks/useDragWindow'
import { useWindowFocus } from '../../hooks/useWindowFocus'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useWindowEscape, WINDOW_ATTR } from '../../hooks/useWindowEscape'
import { useDataStore, useGeoStore, inspectorOpenedOnLoad } from '../../store/StoreContext'
import { CODE_DOCKED_KEY, useCodeDock, useInitialCodeDocked } from './codeDock'
import { usePanelOffset } from '../../hooks/usePanelOffset'
import { useJumpToFeature } from '../../hooks/useJumpToFeature'
import { startDragShield } from '../../hooks/dragShield'
import { Tooltip } from '../ui/Tooltip'
import { resizeEdgeLeft } from '../ui/resizeEdge'
import { panelHeaderIconBtn } from '../ui/panelHeader'
import { useTheme } from '../../contexts/ThemeContext'
import { useAccentStyle } from '../../hooks/useAccentStyle'
import { buildDoc, canonicalRuns, changesOverlap, smallestChange, isFeature, featureIssue, jsonError, parseLenient, separatorFixes, diffDoc, docMapOf, docPieces, featureIndexAtLine, featureLines, featureStartLines, parseEdits, scanFeatureRange, type DocMap } from '../../utils/geojsonDocument'

interface GeoJSONModalProps {
  onClose: () => void
}

const SIZE_KEY = 'elm_code_win_size'
// Typing reaches the store (layer list, map) this long after the last keystroke.
const COMMIT_DELAY = 100
// Above this many characters, invalid text mid-typing isn't re-parsed whole on every pause.
const FULL_PARSE_MAX = 2_000_000

// ── Unapplied typing ───────────────────────────────────────────────────────────

/** Why the editor's text isn't applied to the store: a lint mark at from…to, and the footer status. */
interface Problem { kind: 'syntax' | 'feature' | 'collection'; from: number; to: number; message: string }

const PROBLEM_TEXT: Record<Problem['kind'], (line: number) => string> = {
  syntax: (line) => `Invalid JSON at line ${line}`,
  feature: (line) => `Invalid feature at line ${line}`,
  collection: () => 'Not a GeoJSON FeatureCollection',
}

/**
 * Typing the store doesn't have (invalid JSON, or refused) when the inspector
 * closes — or remounts to dock / undock. The next mount restores it as if the
 * inspector had stayed open: sync() patches store changes made meanwhile around
 * it, or replaces it where they touch the feature being typed into (as it does
 * while open). Without a map, any store change replaces it.
 */
interface Draft {
  doc: Text
  map: DocMap | null
  edit: { base: Text; changes: ChangeSet } | null
  store: { features: readonly GeoJSONFeature[]; schemas: Schema[]; groups: Group[] }
}
const drafts = new WeakMap<object, Draft>() // per data store

/** Syntax error at `pos`: marks the token there (to a space, punctuation or the line's end). */
function syntaxProblem(doc: Text, pos: number, message: string): Problem {
  pos = Math.max(0, Math.min(pos, doc.length))
  const line = doc.lineAt(pos)
  let to = pos
  while (to < line.to && (to === pos || !/[\s,:{}[\]]/.test(line.text[to - line.from]))) to++
  return { kind: 'syntax', from: pos, to, message }
}

/** Whole-line mark: a feature that isn't one, or the collection itself. */
function lineProblem(doc: Text, lineNo: number, kind: Problem['kind'], message: string): Problem {
  const line = doc.line(Math.max(1, Math.min(lineNo, doc.lines)))
  return { kind, from: line.from + (line.text.length - line.text.trimStart().length), to: line.to, message }
}

// ── Feature highlight extension ────────────────────────────────────────────────

// The highlighted feature as a character range; line decorations are built for
// the visible part only, so a 200k-line feature doesn't create 200k decorations.
const setHighlight = StateEffect.define<{ from: number; to: number } | null>()
const highlightDeco = Decoration.line({ class: 'cm-feature-highlight' })

const highlightRange = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHighlight)) return e.value
    return v && tr.docChanged ? { from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) } : v
  },
})

function buildHighlight(view: EditorView): DecorationSet {
  const r = view.state.field(highlightRange)
  if (!r) return Decoration.none
  const doc = view.state.doc
  const b = new RangeSetBuilder<Decoration>()
  let next = 0 // first position not yet decorated (visible ranges can share a line)
  for (const { from, to } of view.visibleRanges) {
    const end = Math.min(to, r.to)
    for (let pos = Math.max(from, r.from, next); pos <= end;) {
      const line = doc.lineAt(pos)
      b.add(line.from, line.from, highlightDeco)
      pos = next = line.to + 1
    }
  }
  return b.finish()
}

const featureHighlight = [highlightRange, ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = buildHighlight(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.startState.field(highlightRange) !== u.state.field(highlightRange)) {
      this.decorations = buildHighlight(u.view)
    }
  }
}, { decorations: (p) => p.decorations })]

/** Marks transactions that mirror the store into the editor, so they aren't parsed back into it. */
const fromStore = Annotation.define<boolean>()
/**
 * Annotations for writing the store's text into the editor. Kept out of the
 * undo history: undo then only reverts the user's typing — never the fill
 * (back to an empty document, which commits as "delete every feature") nor a
 * store patch (silently reverting a map edit through the text).
 */
const storeWrite = [fromStore.of(true), Transaction.addToHistory.of(false)]

/** Serialising up to this many positions happens in one go (no Loading… flash); more is sliced. */
const SYNC_POSITIONS = 5000
/** Main-thread budget per slice while filling a large document. */
const SLICE_MS = 12
/** Lines in the first slice of a fill: more than a tall window shows. */
const FIRST_LINES = 200
/** Most lines appended to the editor in one task while filling. */
const FLUSH_LINES = 20000

/** Positions in a geometry, a cheap stand-in for its serialisation cost. Stops counting past `cap`. */
function positions(g: Geometry | null | undefined, cap: number): number {
  if (!g) return 1
  if (g.type === 'GeometryCollection') return g.geometries.reduce((n, c) => n + positions(c, cap), 0)
  const walk = (c: unknown): number => {
    if (!Array.isArray(c) || typeof c[0] === 'number') return 1
    let n = 0
    for (const x of c) { n += walk(x); if (n > cap) break }
    return n
  }
  return walk(g.coordinates)
}

const yieldToMain =(): Promise<void> => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return s?.yield ? s.yield() : new Promise((r) => setTimeout(r, 0))
}

/** The document as a Blob, sliced 1 MB at a time with a yield every 4 MB. */
async function docBlob(doc: Text, type: string): Promise<Blob> {
  const CHUNK = 1 << 20
  const parts: string[] = []
  for (let pos = 0; pos < doc.length; pos += CHUNK) {
    parts.push(doc.sliceString(pos, Math.min(doc.length, pos + CHUNK)))
    if (parts.length % 4 === 0) await yieldToMain()
  }
  return new Blob(parts, { type })
}

// ── Themes ─────────────────────────────────────────────────────────────────────

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--elm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: '1.65', overflow: 'auto' },
})

// Editor chrome in the UI's neutral greys — no blue anywhere on backgrounds
// (CodeMirror's default light theme and oneDark both tint active line,
// gutters, selection and matches blue). Syntax colours stay. Prec.highest:
// earlier extensions win in CodeMirror, so a plain override after oneDark
// would lose to it. Text, gutters, borders, selection and popups follow the
// design tokens when an integrator sets them; the fallbacks are the
// neutral greys used before.
const neutralLight = Prec.highest(EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--elm-text, #262626)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--elm-text-subtle, #a3a3a3)', borderRight: '1px solid var(--elm-border, #e5e5e5)' },
  '.cm-activeLine': { backgroundColor: 'rgb(0 0 0 / 0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgb(0 0 0 / 0.04)', color: 'var(--elm-text-secondary, #525252)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--elm-text, #262626)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--elm-border, #e5e5e5)' },
  '.cm-selectionMatch': { backgroundColor: 'rgb(0 0 0 / 0.06)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'rgb(0 0 0 / 0.1)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'rgb(0 0 0 / 0.08)', outline: '1px solid rgb(0 0 0 / 0.15)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--elm-surface-hover, #f5f5f5)', border: '1px solid var(--elm-border, #e5e5e5)', color: 'var(--elm-text-muted, #737373)' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--elm-surface-raised, #ffffff)', border: '1px solid var(--elm-border, #e5e5e5)' },
  '.cm-feature-highlight': { backgroundColor: 'rgb(0 0 0 / 0.05)' },
}))

const neutralDark = [oneDark, Prec.highest(EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--elm-text, #e5e5e5)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--elm-text-subtle, #737373)', borderRight: '1px solid var(--elm-border, #404040)' },
  '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgb(255 255 255 / 0.06)', color: 'var(--elm-text-secondary, #d4d4d4)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--elm-text, #e5e5e5)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--elm-border, #404040)' },
  '.cm-selectionMatch': { backgroundColor: 'rgb(255 255 255 / 0.1)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'rgb(255 255 255 / 0.15)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'rgb(255 255 255 / 0.12)', outline: '1px solid rgb(255 255 255 / 0.2)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--elm-surface-raised, #262626)', border: '1px solid var(--elm-border, #404040)', color: 'var(--elm-text-muted, #a3a3a3)' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--elm-surface-raised, #262626)', border: '1px solid var(--elm-border, #404040)' },
  '.cm-feature-highlight': { backgroundColor: 'rgb(255 255 255 / 0.07)' },
}, { dark: true }))]

// ── Component ──────────────────────────────────────────────────────────────────

const MIN_W = 320
const MIN_H = 240
const DEFAULT_W = 520
const DEFAULT_H = 480

// Same header icon buttons as every other window and panel.
const iconBtn = `flex ${panelHeaderIconBtn}`

// Floating window or docked to the left of the layers panel. Toggling remounts
// the inspector (key): the editor is built into its container once, and the
// floating window is portaled while the docked one sits in the map area.
export default function GeoJSONModal({ onClose }: GeoJSONModalProps) {
  const { uiStore } = useGeoStore()
  const persistScope = useElementEditorConfig()
  const [docked, setDocked] = useState(useInitialCodeDocked())
  // Opened by the user: focus the editor. Opened on load: leave the page's
  // focus alone. The Dock/Undock click is the user's again.
  const [focusOnMount, setFocusOnMount] = useState(() => !inspectorOpenedOnLoad.has(uiStore))
  const toggleDock = () => {
    setDocked(!docked)
    setFocusOnMount(true)
    writeStorage(CODE_DOCKED_KEY, docked ? '0' : '1', persistScope)
  }
  return <GeoJSONInspector key={String(docked)} onClose={onClose} autoFocus={focusOnMount} docked={docked} onToggleDock={toggleDock} />
}

function GeoJSONInspector({ onClose, autoFocus, docked, onToggleDock }: GeoJSONModalProps & { autoFocus: boolean; docked: boolean; onToggleDock: () => void }) {
  const emit = useContext(EventContext)?.emit
  const { pos, onHandleMouseDown } = useDragWindow('elm_code_win', { x: 100, y: 100 })
  const persistScope = useElementEditorConfig()
  const { zIndex, focus } = useWindowFocus()
  const { dataStore, uiStore } = useGeoStore()
  const features = useDataStore((s) => s.features)
  const schemas = useDataStore((s) => s.schemas)
  const groups = useDataStore((s) => s.groups)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const themeMode = useTheme()
  const accentStyle = useAccentStyle()
  const dock = useCodeDock(docked)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  // What the document holds, per feature; null while filling, or when typing
  // made the per-feature layout unknown. With uncommitted typing it describes
  // `editRef.base`, not the current document.
  const docMapRef = useRef<DocMap | null>(null)
  // Uncommitted typing: the document the map describes + the edits since.
  const editRef = useRef<{ base: Text; changes: ChangeSet } | null>(null)
  // Store features the editor itself just wrote — already shown, nothing to sync.
  const editorFeaturesRef = useRef<readonly GeoJSONFeature[] | null>(null)
  const syncRef = useRef<() => void>(() => {})
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const themeRef = useRef(themeMode)
  const winRef = useRef<HTMLDivElement>(null)
  const prevSelectedIdRef = useRef<string | null>(null)
  // Feature picked by clicking its code: highlighted, but the editor isn't scrolled away from the click.
  const editorPickRef = useRef<string | null>(null)
  const jumpToFeature = useJumpToFeature()
  const jumpRef = useRef(jumpToFeature)
  jumpRef.current = jumpToFeature

  const [loading, setLoading] = useState(true)
  const [docVersion, setDocVersion] = useState(0) // bumps when a sliced sync lands
  const [copied, setCopied] = useState(false)
  // Typing that isn't applied, and why (also a lint mark in the editor).
  const [problem, setProblem] = useState<{ kind: Problem['kind']; line: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const r = readStorage(SIZE_KEY, persistScope)
      return r ? JSON.parse(r) as { w: number; h: number } : { w: DEFAULT_W, h: DEFAULT_H }
    } catch { return { w: DEFAULT_W, h: DEFAULT_H } }
  })

  const saveSize = useCallback((w: number, h: number) => {
    writeStorage(SIZE_KEY, JSON.stringify({ w, h }), persistScope)
  }, [persistScope])

  useEffect(() => { themeRef.current = themeMode }, [themeMode])

  usePanelOffset(winRef, docked)

  // Escape inside closes it once CodeMirror has had its turn (autocomplete,
  // search panel, extra cursors: those preventDefault). Typing that isn't
  // applied is kept as a draft, as for any close. Floating, it's also the top
  // window Escape from the map closes; docked, it's a panel and stays. Before
  // the editor mounts, so focus goes back to the opener, not the editor.
  useWindowEscape(winRef, true, onClose, zIndex, { topWindow: !docked })

  // ── Custom resize handle ─────────────────────────────────────────────────────
  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h
    const endShield = startDragShield('se-resize')

    function onMove(ev: MouseEvent) {
      const newW = Math.max(MIN_W, Math.min(window.innerWidth * 0.9, startW + ev.clientX - startX))
      const newH = Math.max(MIN_H, Math.min(window.innerHeight * 0.85, startH + ev.clientY - startY))
      setSize({ w: newW, h: newH })
    }

    function onUp() {
      endShield()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const el = winRef.current
      if (el) saveSize(el.offsetWidth, el.offsetHeight)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Mount editor once ────────────────────────────────────────────────────────
  // The editor mounts empty and read-only, so the window paints at once; sync()
  // then fills it — in slices when there's a lot to serialise — and from then on
  // patches only the features whose object changed.
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false
    let closing = false // unmounting: a last commit runs, nothing is shown any more
    let readOnly = true
    // The editor shows typing the store doesn't have yet (pending, invalid or refused).
    let pendingTyping = false
    let shown: Problem | null = null
    // A restored draft without a map: the store it was typed against. sync()
    // leaves the text alone while the store is still that.
    let held: Draft['store'] | null = null
    const cache = new WeakMap<GeoJSONFeature, string[]>()
    const linesOf = (f: GeoJSONFeature) => {
      let lines = cache.get(f)
      if (!lines) { lines = featureLines(f); cache.set(f, lines) }
      return lines
    }

    // Typing → store, COMMIT_DELAY after the last keystroke. Only the features
    // the edits touched are re-parsed and replaced (the rest keep their object);
    // the whole document is parsed only when an edit reaches the header or the
    // footer, or the map no longer applies.
    let typedAt = 0

    // Shows why the text isn't applied (a lint mark + the footer status), or clears it.
    function report(p: Problem | null) {
      if (closing || (!p && !shown)) return
      shown = p
      view.dispatch(setDiagnostics(view.state, p ? [{ from: p.from, to: p.to, severity: 'error', message: p.message }] : []))
      setProblem(p && { kind: p.kind, line: view.state.doc.lineAt(p.from).number })
    }

    // The store took the text.
    function applied() {
      pendingTyping = false
      held = null
      report(null)
    }

    // The first error in a run of edited features (doc from…to, as parseEdits found it).
    function runProblem(from: number, to: number): Problem {
      const doc = view.state.doc
      const list = '[' + doc.sliceString(from, to) + ']'
      const err = jsonError(list)
      const parsed = err ? null : parseLenient(list)
      if (!Array.isArray(parsed)) return syntaxProblem(doc, from + (err ? err.pos - 1 : 0), err?.message ?? 'Invalid JSON')
      const k = Math.max(0, parsed.findIndex((f) => !isFeature(f)))
      const at = scanFeatureRange(doc, k, doc.lineAt(from).number)
      return lineProblem(doc, at ? at.start : doc.lineAt(from).number, 'feature', featureIssue(parsed[k]))
    }

    // The first error in the whole text, which parseLenient read as `parsed`.
    function docProblem(str: string, parsed: { type?: unknown; features?: unknown } | null): Problem {
      const doc = view.state.doc
      if (!parsed) {
        const err = jsonError(str)
        return syntaxProblem(doc, err ? err.pos : 0, err?.message ?? 'Invalid JSON')
      }
      if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        return lineProblem(doc, 1, 'collection', 'Expected { "type": "FeatureCollection", "features": [ … ] }')
      }
      const k = parsed.features.findIndex((f) => !isFeature(f))
      const at = scanFeatureRange(doc, k)
      return lineProblem(doc, at ? at.start : 1, 'feature', featureIssue(parsed.features[k]))
    }

    // `final`: the inspector is closing — parse now, however big the text.
    function commit(final = false) {
      const map = docMapRef.current
      const edit = editRef.current
      const ds = dataStore.getState()
      const before = ds.features
      // The store moved on since the map: sync() is about to patch around the
      // typing (and re-arm this) or replace it — don't write stale text over it.
      if (map && map.features !== before) return
      let invalid: { from: number; to: number } | null = null
      if (map && edit) {
        const res = parseEdits(edit.base, map, edit.changes, view.state.doc)
        if (res.kind === 'ok' && res.features.length) {
          // In buildDoc's shape next to every edit (after dropping the comma a
          // deleted last feature leaves), the map's counts carry on as typed.
          const fixes = res.counts && separatorFixes(view.state.doc, map.headerLines, res.counts, res.around)
          ds.updateFeaturesFromEditor({ type: 'FeatureCollection', features: res.features })
          const after = dataStore.getState().features
          // Refused (feature limit): the typing and the map stay; the next pause retries.
          if (after === before) { report(null); return }
          applied()
          editRef.current = null
          editorFeaturesRef.current = after
          if (fixes) {
            // Finishes the user's deletion, so unlike the store's writes it stays
            // in the undo history, joined to that deletion (see separatorFixes).
            if (fixes.length) view.dispatch({ changes: fixes, annotations: fromStore.of(true) })
            docMapRef.current = { ...map, features: after, counts: res.counts! }
          } else {
            // An edit split features or left them out of shape: the edited runs
            // are rewritten as the store prints them (a store write — out of the
            // undo history, the selection mapped through), so the map survives
            // and the next pause stays incremental.
            const canon = canonicalRuns(edit.base, map, edit.changes, view.state.doc, res.runs, after, linesOf)
            if (canon.changes.length) view.dispatch({ changes: canon.changes, annotations: storeWrite })
            docMapRef.current = { ...map, features: after, counts: canon.counts }
          }
          closeEditOfDeleted(after)
          return
        }
        // Mid-typing: the whole text won't parse either. Re-parsing a big
        // document on every pause to make sure isn't worth it: wait.
        if (res.kind === 'invalid') {
          invalid = res
          if (view.state.doc.length > FULL_PARSE_MAX) { report(runProblem(res.from, res.to)); return }
        }
      }
      const doc = view.state.doc
      // A big document is parsed whole only after a longer pause (~1 s per
      // 10 MB), never on each short pause while typing.
      const wait = doc.length > FULL_PARSE_MAX && !final ? doc.length / 10_000 - (performance.now() - typedAt) : 0
      if (wait > 0) { debounceTimer.current = setTimeout(commit, wait); return }
      const str = doc.toString()
      const parsed = parseLenient(str) as { type?: unknown; features?: unknown; metadata?: unknown } | null
      if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features) || !parsed.features.every(isFeature)) {
        // Invalid — wait for the user to finish, showing where. The edited
        // run's error is the first one (the rest of the text was valid), and
        // finding it there doesn't scan the whole document.
        report(invalid ? runProblem(invalid.from, invalid.to) : docProblem(str, parsed))
        return
      }
      ds.updateFeaturesFromEditor(parsed)
      const after = dataStore.getState().features
      if (after === before) { report(null); return } // refused (feature limit)
      applied()
      editRef.current = null
      editorFeaturesRef.current = after
      const { schemas: ss, groups: gs } = dataStore.getState()
      const { text, map: fresh } = buildDoc(after, ss, gs, linesOf)
      if (text.eq(doc)) docMapRef.current = fresh
      else if (JSON.stringify(parsed.metadata) === JSON.stringify({ schemas: ss, groups: gs })) {
        // Same header, features laid out differently: rewrite the text as the
        // store prints it (a store write, as above) so the map applies again.
        const c = smallestChange(str, text.toString())
        if (c) view.dispatch({ changes: c, annotations: storeWrite })
        docMapRef.current = fresh
      } else docMapRef.current = null // typed into the header (the store doesn't read it): leave it as typed
      closeEditOfDeleted(after)
    }

    // The layers panel's edit form follows its feature out when the text deletes it.
    function closeEditOfDeleted(features: readonly GeoJSONFeature[]) {
      const ui = uiStore.getState()
      const d = ui.dialogState
      if (d.type === 'edit' && !features.some((f) => f.id === d.featureId)) ui.closeDialog()
    }

    // Typing left unapplied when the inspector last closed. Without a map only
    // the very store it was typed against can take it back (sync() can't patch around it).
    const st = dataStore.getState()
    let draft = drafts.get(dataStore) ?? null
    drafts.delete(dataStore)
    if (draft && !draft.map && !(draft.store.features === st.features && draft.store.schemas === st.schemas && draft.store.groups === st.groups)) draft = null

    const view = new EditorView({
      state: EditorState.create({
        doc: draft ? draft.doc : '',
        extensions: [
          basicSetup,
          jsonLang(),
          featureHighlight,
          readOnlyCompartment.current.of(EditorState.readOnly.of(true)),
          themeCompartment.current.of(themeRef.current === 'dark' ? neutralDark : neutralLight),
          baseTheme,
          EditorView.updateListener.of((update) => {
            // A click in a feature's code selects it (as a click in the layer
            // list does) and moves the map to it. Not while typing is
            // uncommitted: the map then describes older text.
            if (update.selectionSet && !update.docChanged && update.transactions.some((tr) => tr.isUserEvent('select.pointer'))) {
              const sel = update.state.selection.main
              const map = docMapRef.current
              if (sel.empty && map && !editRef.current) {
                const f = map.features[featureIndexAtLine(map, update.state.doc.lineAt(sel.head).number)]
                const { selectedIds, selectFeature } = dataStore.getState()
                if (f && !(selectedIds.length === 1 && selectedIds[0] === f.id)) {
                  editorPickRef.current = f.id
                  selectFeature(f.id)
                  jumpRef.current(f)
                }
              }
            }
            let typed = false
            for (const tr of update.transactions) {
              if (!tr.docChanged || tr.annotation(fromStore)) continue
              typed = true
              if (!docMapRef.current) continue
              const e = editRef.current
              editRef.current = e
                ? { base: e.base, changes: e.changes.compose(tr.changes) }
                : { base: tr.startState.doc, changes: tr.changes }
            }
            if (!typed) return
            pendingTyping = true
            typedAt = performance.now()
            if (update.transactions.some((tr) => tr.docChanged && tr.annotation(fromStore))) {
              // A store patch batched with typing: the edits can't be tracked — parse it all.
              docMapRef.current = null
              editRef.current = null
            }
            if (debounceTimer.current) clearTimeout(debounceTimer.current)
            debounceTimer.current = setTimeout(commit, COMMIT_DELAY)
          }),
        ],
      }),
      parent: containerRef.current,
    })

    // Read-only while filling, and always in a readonly editor.
    let filling = true
    const applyReadOnly = () => {
      const on = filling || uiStore.getState().readonly
      if (on === readOnly) return
      readOnly = on
      view.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(on)) })
    }
    const setReadOnly = (on: boolean) => { filling = on; applyReadOnly() }
    const unsubscribeReadonly = uiStore.subscribe((s, prev) => { if (s.readonly !== prev.readonly) applyReadOnly() })

    /** Replaces the document with the store's, appended in SLICE_MS slices. False if disposed meanwhile. */
    async function fill(fs: readonly GeoJSONFeature[], ss: Schema[], gs: Group[]): Promise<boolean> {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      editRef.current = null
      docMapRef.current = null
      pendingTyping = false
      report(null)
      let flushes = 0
      let buf: string[] = []
      // Appends `buf` (FLUSH_LINES at a time, so one 200k-line feature isn't one long task), yielding after each.
      const flush = async (): Promise<boolean> => {
        for (let i = 0; i < buf.length; i += FLUSH_LINES) {
          const lines = buf.slice(i, i + FLUSH_LINES)
          const doc = view.state.doc
          view.dispatch({
            changes: flushes++ ? { from: doc.length, insert: Text.of(['', ...lines]) } : { from: 0, to: doc.length, insert: Text.of(lines) },
            annotations: storeWrite,
          })
          await yieldToMain()
          if (disposed) return false
        }
        buf = []
        return true
      }
      let t = performance.now()
      for (const piece of docPieces(fs, ss, gs, linesOf)) {
        for (const l of piece) buf.push(l)
        // The header goes up at once and the next slice is a screenful, so the
        // window shows text right away; after that, SLICE_MS slices.
        if (flushes < 2 ? !flushes || buf.length > FIRST_LINES : performance.now() - t > SLICE_MS) {
          if (!(await flush())) return false
          t = performance.now()
        }
      }
      if (!(await flush())) return false
      docMapRef.current = docMapOf(fs, ss, gs, linesOf)
      return true
    }

    // One sync at a time; a store change during a sliced one re-runs it against the latest state.
    let running = false
    let pending = false
    async function sync() {
      if (running) { pending = true; return }
      running = true
      let sliced = false
      try {
        do {
          pending = false
          const { features: fs, schemas: ss, groups: gs } = dataStore.getState()
          const map = docMapRef.current
          const same = map ?? held
          if (same && same.features === fs && same.schemas === ss && same.groups === gs) continue
          held = null
          const missing = fs.filter((f) => !cache.has(f))
          let cost = 0
          for (const f of missing) { cost += positions(f.geometry, SYNC_POSITIONS); if (cost > SYNC_POSITIONS) break }
          const rebuild = !map || !map.features.length || !fs.length // diffDoc can't patch these
          if (cost > SYNC_POSITIONS) {
            // Read-only meanwhile so typing can't race the fill.
            sliced = true
            setReadOnly(true)
            if (rebuild) {
              // Serialise and show the document slice by slice: the first
              // screenful is up in the first frame, no slice is a long task.
              const loaded = await fill(fs, ss, gs)
              if (!loaded) return
              continue
            }
            // Serialise in slices, after a first paint.
            await yieldToMain()
            if (disposed) return
            let t = performance.now()
            for (const f of missing) {
              linesOf(f)
              if (performance.now() - t > SLICE_MS) {
                await yieldToMain()
                if (disposed) return
                t = performance.now()
              }
            }
          }
          const edit = editRef.current
          const base = edit ? edit.base : view.state.doc
          const patch = map && !rebuild ? diffDoc(base, map, fs, ss, gs, linesOf) : null
          const storeChanges = patch && ChangeSet.of(patch.changes, base.length)
          if (storeChanges && !edit) {
            view.dispatch({ changes: storeChanges, annotations: storeWrite })
            docMapRef.current = patch.map
          } else if (storeChanges && edit && !changesOverlap(storeChanges, edit.changes)) {
            // Uncommitted typing elsewhere in the document: apply the store's
            // patch around it (mapped through the typing), keep the typing pending.
            view.dispatch({ changes: storeChanges.map(edit.changes), annotations: storeWrite })
            editRef.current = { base: storeChanges.apply(base), changes: edit.changes.map(storeChanges, true) }
            docMapRef.current = patch.map
            if (debounceTimer.current) clearTimeout(debounceTimer.current)
            debounceTimer.current = setTimeout(commit, COMMIT_DELAY)
          } else {
            // Empty, empty ↔ non-empty, unknown layout, or the store changed a
            // feature being typed into: rebuild. A store change replaces
            // unparsed typing there, as it always has.
            if (debounceTimer.current) clearTimeout(debounceTimer.current)
            editRef.current = null
            const { text, map: fresh } = buildDoc(fs, ss, gs, linesOf)
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: storeWrite })
            docMapRef.current = fresh
            pendingTyping = false
            report(null)
          }
        } while (pending)
      } finally {
        running = false
        if (!disposed) {
          setReadOnly(false)
          setLoading(false)
          if (sliced) setDocVersion((v) => v + 1)
        }
      }
    }

    viewRef.current = view
    docMapRef.current = draft ? draft.map : null
    editRef.current = draft ? draft.edit : null
    if (draft) {
      pendingTyping = true
      held = draft.map ? null : draft.store
      // Shows where it's invalid again (or applies it, if the store now takes it).
      debounceTimer.current = setTimeout(commit, 0)
    }
    syncRef.current = () => { void sync() }
    if (autoFocus) view.focus()
    void sync()

    return () => {
      unsubscribeReadonly()
      syncRef.current = () => {}
      // Typing within the last pause still goes to the store; what it doesn't
      // take is kept for the next mount rather than silently dropped.
      closing = true
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      if (pendingTyping && !running) commit(true)
      disposed = true
      if (pendingTyping) {
        const { features: fs, schemas: ss, groups: gs } = dataStore.getState()
        drafts.set(dataStore, { doc: view.state.doc, map: docMapRef.current, edit: editRef.current, store: { features: fs, schemas: ss, groups: gs } })
      }
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync store → editor ──────────────────────────────────────────────────────
  useEffect(() => {
    if (features === editorFeaturesRef.current) {
      editorFeaturesRef.current = null // written by the editor; it already shows this
      return
    }
    syncRef.current()
  }, [features, schemas, groups])

  // ── Theme switching ──────────────────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current
    const theme = themeMode === 'dark' ? neutralDark : neutralLight
    // The editor mounts with the current theme; reconfiguring to the same one still restyles it.
    if (!view || themeCompartment.current.get(view.state) === theme) return
    view.dispatch({ effects: themeCompartment.current.reconfigure(theme) })
  }, [themeMode])

  // ── Highlight selected feature (scroll only when selection changes) ───────────
  useEffect(() => {
    const view = viewRef.current
    if (!view || loading) return

    const selectedId = selectedIds[0] ?? null
    const selectionChanged = selectedId !== prevSelectedIdRef.current
    prevSelectedIdRef.current = selectedId
    const fromEditor = editorPickRef.current === selectedId
    editorPickRef.current = null

    if (selectedId === null) {
      view.dispatch({ effects: setHighlight.of(null) })
      return
    }

    const doc = view.state.doc
    const map = editRef.current ? null : docMapRef.current // with uncommitted typing the map describes an older text
    let range: { start: number; end: number } | null
    if (map) {
      const idx = map.features.findIndex((f) => f.id === selectedId)
      if (idx === -1) return
      const start = featureStartLines(map)[idx]
      range = { start, end: start + map.counts[idx] - 1 }
    } else {
      // Typed into: find it by scanning the text, as the doc may not match the store.
      const idx = features.findIndex((f) => f.id === selectedId)
      if (idx === -1) return
      range = scanFeatureRange(doc, idx)
    }
    if (!range || range.start > doc.lines) return

    const from = doc.line(range.start).from
    const scrollEffect = selectionChanged && !fromEditor ? [EditorView.scrollIntoView(from, { y: 'center' })] : []
    view.dispatch({
      effects: [setHighlight.of({ from, to: doc.line(Math.min(range.end, doc.lines)).to }), ...scrollEffect],
    })
  }, [selectedIds, features, loading, docVersion])

  useFocusTrap(winRef, !docked)

  // The editor holds the serialised text (including unsaved typing): copy and
  // download read it, nothing is stringified again. It goes out as a Blob built
  // from 1 MB slices, so a 20 MB document never becomes one main-thread string.
  // Disabled until it's filled.
  function handleCopy() {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc
    // A ClipboardItem given a promise keeps the click's user activation while the blob builds.
    const write = Promise.resolve().then(() => typeof ClipboardItem !== 'undefined'
      ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': docBlob(doc, 'text/plain') })])
      : navigator.clipboard.writeText(doc.toString()))
    write.then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }, (err) => emit?.(clipboardErrorEvent(err)))
  }

  // The status line's line number leads to the lint mark (mapped through any typing since).
  function goToProblem() {
    const view = viewRef.current
    if (!view) return
    let at = -1
    forEachDiagnostic(view.state, (_, from) => { if (at < 0) at = from })
    if (at < 0) return
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    view.focus()
  }

  async function handleDownload() {
    const view = viewRef.current
    if (!view) return
    const blob = await docBlob(view.state.doc, 'application/geo+json')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'features.geojson'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const featureCount = features.length

  const iconSize = 16

  const win = (
      <div
        ref={winRef}
        onMouseDownCapture={docked ? undefined : focus}
        role={docked ? 'region' : 'dialog'}
        aria-label="GeoJSON inspector"
        {...{ [WINDOW_ATTR]: '' }}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        data-elm-code-docked={docked || undefined}
        className={docked
          ? dock.className
          : 'fixed flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-raised rounded-elm-window overflow-hidden'}
        style={docked
          ? dock.style
          : {
            left: pos.x,
            top: pos.y,
            zIndex,
            minWidth: MIN_W,
            minHeight: MIN_H,
            width: size.w,
            height: size.h,
            maxWidth: '90vw',
            maxHeight: '85vh',
          }}
      >
        {docked && (
          <div
            onMouseDown={dock.onHandleMouseDown}
            className={resizeEdgeLeft}
            title="Drag to resize panel"
          />
        )}
        {/* Title bar. Docked it matches the Layers panel header beside it
            (padding, label, row height) so the two read as one strip. */}
        <div
          onMouseDown={docked ? undefined : onHandleMouseDown}
          className={`flex items-center justify-between border-b border-elm-border flex-shrink-0 select-none ${docked ? 'px-3 py-1.5 bg-elm-surface-sunken' : 'px-4 py-3'}`}
          style={docked ? undefined : { cursor: 'grab' }}
        >
          <span className={docked
            ? 'text-xs font-medium text-elm-text-secondary'
            : 'text-sm font-semibold text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100))'}>GeoJSON</span>
          <div className={`flex items-center gap-0.5 ${docked ? 'h-6' : ''}`}>
            <span className="text-xs text-elm-text-subtle mr-1.5">
              {featureCount} feature{featureCount !== 1 ? 's' : ''}
            </span>
            <Tooltip content={copied ? 'Copied' : 'Copy'} side="bottom">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleCopy}
                disabled={loading}
                aria-label={copied ? 'Copied' : 'Copy'}
                className={iconBtn}
              >
                {copied ? <Check size={iconSize} className="text-green-500" /> : <Copy size={iconSize} />}
              </button>
            </Tooltip>
            <Tooltip content="Download" side="bottom">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleDownload}
                disabled={loading}
                aria-label="Download GeoJSON"
                className={iconBtn}
              >
                <DownloadSimple size={iconSize} />
              </button>
            </Tooltip>
            <Tooltip content={docked ? 'Undock' : 'Dock to the side'} side="bottom">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onToggleDock}
                aria-label={docked ? 'Undock GeoJSON inspector' : 'Dock GeoJSON inspector'}
                className={iconBtn}
              >
                {/* Mirrored: bar on the right = docked beside the layers panel. */}
                {docked ? <ArrowSquareOut size={iconSize} /> : <SidebarSimple size={iconSize} className="-scale-x-100" />}
              </button>
            </Tooltip>
            {docked
              ? <Tooltip content="Close" side="bottom"><button onClick={onClose} aria-label="Close" className={iconBtn}><X size={iconSize} /></button></Tooltip>
              : <CloseButton onClick={onClose} />}
          </div>
        </div>

        {/* CodeMirror editor */}
        <div className="relative flex-1 flex flex-col min-h-0">
          <div ref={containerRef} className="flex-1 overflow-hidden min-h-0" />
          {/* The document fills from the top while it loads; the note stays out of its way. */}
          {loading && (
            <div className="absolute bottom-2 right-4 text-xs text-elm-text-subtle pointer-events-none">
              Loading…
            </div>
          )}
        </div>

        {/* Why typing isn't applied. Nothing in the text reaches the store until it parses. */}
        <div role="status" aria-live="polite" className="flex-shrink-0">
          {problem && (
            <button
              type="button"
              onClick={goToProblem}
              title="Go to the error"
              data-elm-inspector-problem={problem.kind}
              className={`flex w-full items-center gap-1.5 border-t border-elm-border py-1.5 text-left text-xs text-(--elm-text-secondary,var(--color-gray-600)) dark:text-(--elm-text-secondary,var(--color-gray-300)) hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,color-mix(in_oklab,var(--color-gray-800)_60%,transparent)) ${docked ? 'px-3' : 'pl-4 pr-6'}`}
            >
              <WarningCircle size={14} className="flex-shrink-0 text-elm-text-muted" />
              <span className="min-w-0 truncate">{PROBLEM_TEXT[problem.kind](problem.line)} — no changes apply until it's fixed</span>
            </button>
          )}
        </div>

        {/* Resize handle */}
        {!docked && <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize select-none"
          style={{ zIndex: 10 }}
          aria-hidden
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 right-1 text-elm-text-disabled">
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>}
      </div>
  )

  return docked ? win : createPortal(
    <div data-elm-theme={themeMode} style={accentStyle}>{win}</div>,
    document.body,
  )
}
