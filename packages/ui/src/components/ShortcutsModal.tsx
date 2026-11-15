import { useEffect, useRef, useState, useCallback } from 'react'
import { useWindowEscape, WINDOW_ATTR } from '../hooks/useWindowEscape'
import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { useUIStore } from '../store/StoreContext'
import { useShortcutConfig } from '../contexts/ShortcutConfigContext'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { getFixedShortcutFullDisplay, readStorage, writeStorage } from '@element-editor/core'
import { CUSTOMIZABLE_SHORTCUTS, FIXED_SHORTCUTS } from '@element-editor/core/internal'
import type { ShortcutId } from '@element-editor/core'
import type { CustomizableShortcut } from '@element-editor/core/internal'
import { Kbd } from './ui/Kbd'
import { CloseButton } from './ui/CloseButton'
import { useDragWindow } from '../hooks/useDragWindow'
import { startDragShield } from '../hooks/dragShield'
import { useWindowFocus } from '../hooks/useWindowFocus'

const TOOL_SHORTCUT_MAP: Partial<Record<ShortcutId, string>> = {
  'place-point':   'point',
  'draw-line':     'line',
  'draw-polygon':  'polygon',
  'draw-route':    'route',
  'draw-circle':   'circle',
  'draw-rect':     'rectangle',
  'draw-freehand': 'freehand',
  'picker':        'picker',
}

// ---------------------------------------------------------------------------
// KeyCapture — focused button that intercepts the next keypress
// ---------------------------------------------------------------------------
function KeyCapture({
  current,
  onCapture,
  onCancel,
}: {
  current: string
  onCapture: (key: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // Focus + select the existing key on open so any next key overwrites it
  // immediately. `readOnly` keeps the browser from actually editing the value
  // — we handle keydown ourselves and call onCapture with the pressed key.
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      readOnly
      value={current.toUpperCase()}
      // `size={1}` collapses the input's default 20-char width. Actual visible
      // width is still controlled by the Tailwind class below so it matches the
      // resting Kbd badge.
      size={1}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') { onCancel(); return }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
          onCapture(e.key.toLowerCase())
        }
      }}
      onBlur={onCancel}
      aria-label="Press a key to rebind"
      // Footprint matches the resting Kbd badge exactly (w-6 = 1.5rem,
      // h-5, text-[11px], rounded, border) so there's zero layout shift
      // when toggling into capture mode. Primary ring replaces the prior
      // pulsing animation and trailing "…".
      className="inline-block w-6 h-5 text-[11px] font-medium font-elm rounded-elm-chip border border-primary-400 bg-primary-50 text-primary-700 text-center p-0 outline-none caret-transparent selection:bg-primary-500 selection:text-white"
    />
  )
}

// ---------------------------------------------------------------------------
// ShortcutsModal — non-blocking floating window
// ---------------------------------------------------------------------------
export function ShortcutsModal() {
  const open = useUIStore((s) => s.shortcutsModalOpen)
  const closeShortcutsModal = useUIStore((s) => s.closeShortcutsModal)
  const readonly = useUIStore((s) => s.readonly)
  const unavailableTools = useUIStore((s) => s.unavailableTools)
  const { tools, ui, toolbar } = useElementEditorConfig()
  const isVertical = toolbar.direction === 'vertical'
  const toolSet = tools === 'all' ? null : new Set(tools)

  function isShortcutVisible(id: ShortcutId): boolean {
    if (id === 'toggle-table')     return ui.dataTable
    if (id === 'toggle-geojson')   return ui.geojsonEditor
    if (id === 'toggle-schema')    return ui.schemaEditor
    if (id === 'toggle-sidebar')   return ui.layerList
    if (id === 'set-zoom')         return ui.zoomIndicator
    const tool = TOOL_SHORTCUT_MAP[id]
    if (tool && unavailableTools.includes(tool)) return false
    if (tool && toolSet) return toolSet.has(tool as import('../contexts/ElementEditorConfigContext').DrawTool)
    return true
  }

  const { custom, getKey, setKey, resetKey, resetAll } = useShortcutConfig()

  const [capturing, setCapturing] = useState<ShortcutId | null>(null)
  // One state object for the rebind-conflict UI: the row it's attached to
  // (pins the inline tooltip), the message, and the key the user tried —
  // shown selected inside KeyCapture so the next keypress overwrites it.
  // These three fields are always set/cleared together, so one object is
  // clearer than three parallel useState calls.
  const [conflict, setConflict] = useState<
    { id: ShortcutId; msg: string; attemptedKey: string } | null
  >(null)

  const { pos, onHandleMouseDown } = useDragWindow('elm_shortcuts_win', { x: 24, y: 120 })

  const persistScope = useElementEditorConfig()
  const { zIndex, focus } = useWindowFocus(open)

  const SIZE_KEY = 'elm_shortcuts_win_size'
  const MIN_W = 250
  const MIN_H = 260
  const winRef = useRef<HTMLDivElement>(null)
  // Escape closes it (from inside, or from the map once nothing else is
  // cancelled); focus goes back where it was. Key capture handles its own.
  useWindowEscape(winRef, open, closeShortcutsModal, zIndex)
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const r = readStorage(SIZE_KEY, persistScope)
      return r ? JSON.parse(r) as { w: number; h: number } : { w: 440, h: 560 }
    } catch { return { w: 440, h: 560 } }
  })
  const saveSize = useCallback((w: number, h: number) => {
    writeStorage(SIZE_KEY, JSON.stringify({ w, h }), persistScope)
  }, [persistScope])

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h
    const endShield = startDragShield('se-resize')
    function onMove(ev: MouseEvent) {
      setSize({
        w: Math.max(MIN_W, Math.min(window.innerWidth * 0.9, startW + ev.clientX - startX)),
        h: Math.max(MIN_H, Math.min(window.innerHeight * 0.85, startH + ev.clientY - startY)),
      })
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

  // Escape during key-capture: cancel capture and stop propagation so nothing else reacts
  // (it doesn't close the window). When not capturing, Escape closes it (useWindowEscape).
  // The cancel itself has to happen here (not in KeyCapture's own onKeyDown)
  // because we stopPropagation in the capture phase — if we only called it
  // from the input's bubble-phase handler, the stopPropagation above would
  // prevent the event from ever reaching the input.
  useEffect(() => {
    if (!open || capturing === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancelCapture()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, capturing])

  if (!open) return null

  function handleCapture(id: ShortcutId, key: string) {
    const conflictId = setKey(id, key)
    if (conflictId) {
      const label = CUSTOMIZABLE_SHORTCUTS.find((s) => s.id === conflictId)?.label ?? conflictId
      // Leave `capturing` pinned but swap the visible value to the attempted
      // key so the user sees what they just tried (selected, ready to be
      // overwritten by the next keypress).
      setConflict({ id, msg: `"${key.toUpperCase()}" is already used by "${label}"`, attemptedKey: key })
      return
    }
    setConflict(null)
    setCapturing(null)
  }

  function cancelCapture() {
    setCapturing(null)
    setConflict(null)
  }

  function startCapture(id: ShortcutId) {
    setCapturing(id)
    setConflict(null)
  }

  // Builds the full prop set for a customizable-shortcut row — used three
  // times (drawing / view / editing sections) so we build it once here and
  // spread below. `key` is passed at the call site so React doesn't warn.
  function rowPropsFor(s: CustomizableShortcut) {
    return {
      label: s.label,
      isChanged: custom[s.id] !== undefined,
      isCapturing: capturing === s.id,
      keyDisplay: getKey(s.id),
      onStartCapture: () => startCapture(s.id),
      onCapture: (k: string) => handleCapture(s.id, k),
      onCancelCapture: cancelCapture,
      onReset: () => { resetKey(s.id); setConflict(null) },
      conflictMsg: conflict?.id === s.id ? conflict.msg : undefined,
      onDismissConflict: () => setConflict(null),
      captureDisplay: conflict?.id === s.id ? conflict.attemptedKey : undefined,
    }
  }

  const drawingShortcuts = CUSTOMIZABLE_SHORTCUTS.filter((s) => s.category === 'drawing' && !readonly && isShortcutVisible(s.id))
  const viewShortcuts = CUSTOMIZABLE_SHORTCUTS.filter((s) => s.category === 'view' && isShortcutVisible(s.id))
  const editingShortcuts = CUSTOMIZABLE_SHORTCUTS.filter((s) => s.category === 'editing' && !readonly && isShortcutVisible(s.id))
  const fixedView = FIXED_SHORTCUTS.filter((s) => s.category === 'view' && !(isVertical && s.label === 'Search places'))
  const fixedEditing = readonly ? [] : FIXED_SHORTCUTS.filter((s) => s.category === 'editing')
  const fixedDrawing = readonly ? [] : FIXED_SHORTCUTS.filter((s) => s.category === 'drawing')
  const isCustomized = Object.keys(custom).length > 0

  return (
    <div
      ref={winRef}
      {...{ [WINDOW_ATTR]: '' }}
      role="dialog"
      aria-label="Keyboard shortcuts"
      onMouseDownCapture={focus}
      className="fixed flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-raised rounded-elm-window overflow-hidden"
      style={{
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
      {/* Title bar — drag handle */}
      <div
        onMouseDown={onHandleMouseDown}
        className="flex items-center justify-between px-4 py-3 border-b border-elm-border flex-shrink-0 select-none"
        style={{ cursor: 'grab' }}
      >
        <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100))">Keyboard shortcuts</span>
        <CloseButton onClick={closeShortcutsModal} label="Close keyboard shortcuts" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-4 min-h-0">

        {drawingShortcuts.length > 0 && (
          <Section title="Drawing tools">
            {drawingShortcuts.map((s) => <ShortcutRow key={s.id} {...rowPropsFor(s)} />)}
          </Section>
        )}

        {(viewShortcuts.length > 0 || fixedView.length > 0) && (
          <Section title="View">
            {viewShortcuts.map((s) => <ShortcutRow key={s.id} {...rowPropsFor(s)} />)}
            {fixedView.map((s) => (
              <FixedRow key={s.id} label={s.label} display={getFixedShortcutFullDisplay(s.id)} />
            ))}
          </Section>
        )}

        {(editingShortcuts.length > 0 || fixedEditing.length > 0) && (
          <Section title="Editing">
            {editingShortcuts.map((s) => <ShortcutRow key={s.id} {...rowPropsFor(s)} />)}
            {fixedEditing.map((s) => (
              <FixedRow key={s.id} label={s.label} display={getFixedShortcutFullDisplay(s.id)} />
            ))}
          </Section>
        )}

        {fixedDrawing.length > 0 && (
          <Section title="While drawing">
            {fixedDrawing.map((s) => (
              <FixedRow key={s.id} label={s.label} display={getFixedShortcutFullDisplay(s.id)} />
            ))}
          </Section>
        )}

      </div>

      {/* Footer — hint + reset all. Conflict messages now render inline
          as tooltips on the offending row (see ShortcutRow). */}
      <div className="flex-shrink-0 border-t border-elm-border-subtle px-6 py-2.5 flex items-center justify-between gap-3">
        <p className="text-xs text-elm-text-subtle flex-1">Click a key badge to rebind it</p>
        {isCustomized && (
          <button
            onClick={() => { resetAll(); setConflict(null) }}
            className="flex items-center gap-1 text-xs text-elm-text-subtle hover:text-(--elm-text-secondary,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-300)) hover:bg-elm-surface-hover rounded-elm-chip px-1.5 py-0.5 -mr-1.5 transition-colors flex-shrink-0"
          >
            <ArrowCounterClockwise size={11} />
            Reset all
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize select-none"
        style={{ zIndex: 10 }}
        aria-hidden
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 right-1 text-elm-text-disabled">
          <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold text-elm-text-subtle uppercase tracking-wider mb-1.5 px-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

function ShortcutRow({
  label, isChanged, isCapturing, keyDisplay,
  onStartCapture, onCapture, onCancelCapture, onReset,
  conflictMsg, onDismissConflict, captureDisplay,
}: {
  label: string
  isChanged: boolean
  isCapturing: boolean
  keyDisplay: string
  onStartCapture: () => void
  onCapture: (k: string) => void
  onCancelCapture: () => void
  onReset: () => void
  conflictMsg?: string
  onDismissConflict: () => void
  /** Overrides the KeyCapture input's value while in capture mode. Used
   *  after a conflict to show the letter the user just tried. */
  captureDisplay?: string
}) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded-elm-card hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-800)) group">
      <span className="text-sm text-elm-text-secondary">{label}</span>
      <div className="flex items-center gap-1.5 relative">
        {conflictMsg && (
          // Inline conflict popover — mirrors the project Tooltip's shape
          // (px-2.5 py-1.5, rounded-lg, shadow-xl, backdrop-blur, 4px arrow)
          // but in rose so it reads as an error. Click to dismiss.
          <button
            type="button"
            onClick={onDismissConflict}
            // 8 px between arrow tip and key edge (mr-2 + 4 px arrow offset
            // by the border-width of the arrow span = ~8 px visible gap).
            className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap bg-rose-500/95 text-white text-xs px-2.5 py-1.5 rounded-elm-card shadow-elm backdrop-blur-sm hover:bg-rose-600/95 transition-colors"
            aria-label="Dismiss conflict message"
          >
            {conflictMsg}
            <span
              aria-hidden
              className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-rose-500/95"
            />
          </button>
        )}
        {isChanged && (
          // Always visible when the binding has been customized — used to live
          // behind a hover gate, which made it discoverable only after pointing
          // at the row. The customized state is now communicated by the
          // presence of this icon alone (the key badge keeps its default
          // styling) so the reset affordance can't be missed.
          <button
            onClick={onReset}
            className="p-0.5 rounded-elm-chip text-elm-text hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) transition-colors"
            aria-label="Reset to default"
            title="Reset to default"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        )}
        {isCapturing ? (
          // `key` forces a remount (fresh focus+select useEffect) whenever
          // the displayed value flips between the stored key and a failed
          // attempt — without it the selection wouldn't re-happen after a
          // conflict and the user would see an unselected caret.
          <KeyCapture
            key={captureDisplay ?? keyDisplay}
            current={captureDisplay ?? keyDisplay}
            onCapture={onCapture}
            onCancel={onCancelCapture}
          />
        ) : (
          <button
            onClick={onStartCapture}
            title="Click to rebind"
            className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 text-[11px] font-medium font-elm rounded-elm-chip transition-colors border border-elm-border-strong bg-(--elm-surface-hover,var(--color-gray-100)) dark:bg-(--elm-surface-hover,var(--color-gray-700)) text-elm-text-muted shadow-[0_1px_0_0_rgba(0,0,0,0.15)] hover:bg-(--elm-control-hover,var(--color-gray-200)) dark:hover:bg-(--elm-control-hover,var(--color-gray-600)) hover:border-(--elm-border-strong,var(--color-gray-400)) dark:hover:border-(--elm-border-strong,var(--color-gray-500))"
          >
            {keyDisplay.toUpperCase()}
          </button>
        )}
      </div>
    </div>
  )
}

function FixedRow({ label, display }: { label: string; display: string }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded-elm-card">
      <span className="text-sm text-elm-text-secondary">{label}</span>
      <Kbd>{display}</Kbd>
    </div>
  )
}
