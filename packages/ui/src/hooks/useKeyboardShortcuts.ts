import { useGeoStore } from '../store/StoreContext'
import { useCallback, useEffect, useRef } from 'react'
import { useEmit } from '../contexts/EventContext'
import { useElementEditorConfig, TOOL_MODES } from '../contexts/ElementEditorConfigContext'
import { useOptionalShortcutConfig } from '../contexts/ShortcutConfigContext'
import { getGeometryBBox, type EditingMode, type ShortcutId } from '@element-editor/core'
import { getCurrentKey as getCachedKey, getEffectiveKey, isMultiGeometry, getPartCount } from '@element-editor/core/internal'
import { useMapController } from '../contexts/MapControllerContext'
import { getVisualFeatureOrder } from '../utils/layerOrder'
import { isContextMenuOpen } from '../components/ui/ContextMenu'
import { saveGeoJSONFile } from '../utils/download'
import { WINDOW_ATTR, closeTopWindow } from './useWindowEscape'
import { useGeoJSONFileImport } from './useGeoJSONFileImport'

/** Open a transient hidden file picker and resolve with the chosen file (or null if cancelled). */
function pickGeoJSONFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.geojson,.json,application/geo+json,application/json'
    input.style.display = 'none'
    document.body.appendChild(input)
    let resolved = false
    const cleanup = () => {
      if (resolved) return
      resolved = true
      input.remove()
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null
      cleanup()
      resolve(file)
    }, { once: true })
    // 'cancel' fires when the user dismisses the picker without choosing — supported in Chromium 113+/Firefox/Safari 16.4+.
    input.addEventListener('cancel', () => { cleanup(); resolve(null) }, { once: true })
    input.click()
  })
}

// ── Instance scoping ─────────────────────────────────────────────────────────
// Shortcuts listen on `window`, but Element lives inside a host page (maybe
// next to a second editor). A key belongs to this editor only when it was
// pressed inside the editor's root, or when focus is nowhere in particular
// (body, or one of Element's body-level portals) and the user last clicked
// inside this editor. Focus on a host button/link/modal never triggers us.

interface ShortcutScope {
  /** Editor root: nearest `[data-elm-theme]` ancestor of the map container, else the container. */
  root: HTMLElement
  /** Was the last pointerdown inside `root`? null = no pointerdown yet. */
  pointerInside: boolean | null
}

/** One entry per editor that mounted `useKeyboardShortcuts(container)`, keyed by its uiStore. */
const scopes = new Map<object, ShortcutScope>()

/**
 * True for nodes in an Element portal (modal windows, menus, pickers), which
 * sit outside every editor root. Portals mark themselves with `data-elm-portal`,
 * or are a body-level `[data-elm-theme]` wrapper.
 */
function inElementEditorPortal(el: Element): boolean {
  if (el.closest('[data-elm-portal]')) return true
  let top = el
  while (top.parentElement && top.parentElement !== document.body) top = top.parentElement
  return top.parentElement === document.body && (top.hasAttribute('data-elm-theme') || top.hasAttribute('data-elm-portal'))
}

function isForScope(e: Event, scope: ShortcutScope | undefined): boolean {
  if (!scope) return true // no container passed: legacy page-wide behaviour
  if (e.composedPath().includes(scope.root)) return true
  const ae = document.activeElement
  const focusNeutral = !ae || ae === document.body || inElementEditorPortal(ae)
  if (!focusNeutral) return false
  // Before any click, a lone editor still owns body-focused keys (page load → press P).
  return scope.pointerInside ?? scopes.size === 1
}

/**
 * Predicate for window/document key listeners: true when the event belongs to
 * the editor of the surrounding GeoStore (same rules as the global shortcuts).
 * Use it in every window-level keydown/keyup that acts on editor state, so a
 * key pressed in the host page or in a second editor is ignored. Stable
 * identity; reads the scope at call time.
 */
export function useIsEventForEditor(): (e: Event) => boolean {
  const { uiStore } = useGeoStore()
  return useCallback((e: Event) => isForScope(e, scopes.get(uiStore)), [uiStore])
}

/**
 * Shortcut feedback: briefly press the button(s) for `id` (`data-elm-shortcut`)
 * inside this editor's root, as if clicked. `data-pressed` mirrors `:active`
 * (see shared.css). Enabled buttons only, like a real click.
 */
const PRESS_MS = 140
function flashShortcutButton(root: ParentNode, id: string) {
  root.querySelectorAll<HTMLButtonElement>(`[data-elm-shortcut="${id}"]`).forEach((b) => {
    if (b.disabled) return
    b.setAttribute('data-pressed', '')
    setTimeout(() => b.removeAttribute('data-pressed'), PRESS_MS)
  })
}

/**
 * Global editor shortcuts. Pass the map container so keys are scoped to this
 * editor instance (see `useIsEventForEditor`); without it the listeners act page-wide.
 */
/** Tools that add a feature, in shortcut-match order. */
const ADD_TOOLS = ['point', 'line', 'polygon', 'route', 'circle', 'rectangle', 'freehand', 'picker'] as const

export function useKeyboardShortcuts(container?: HTMLElement | null) {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const { panTo, fitBounds, setZoom } = useMapController()
  const importFile = useGeoJSONFileImport()
  const cfg = useElementEditorConfig()
  const isForThisEditor = useIsEventForEditor()
  // This editor's bindings (per persistKey); the module cache only outside a provider.
  const shortcutCustom = useOptionalShortcutConfig()?.custom
  const customRef = useRef(shortcutCustom)
  customRef.current = shortcutCustom
  const getCurrentKey = useCallback((id: ShortcutId) =>
    customRef.current ? getEffectiveKey(id, customRef.current) : getCachedKey(id), [])

  useEffect(() => {
    if (!container) return
    const root = (container.closest('[data-elm-theme]') as HTMLElement | null) ?? container
    const scope: ShortcutScope = { root, pointerInside: null }
    scopes.set(uiStore, scope)
    const onPointerDown = (e: PointerEvent) => {
      if (e.composedPath().includes(root)) scope.pointerInside = true
      // Clicks inside an Element modal portal don't move ownership.
      else if (!(e.target instanceof Element && inElementEditorPortal(e.target))) scope.pointerInside = false
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    return () => {
      if (scopes.get(uiStore) === scope) scopes.delete(uiStore)
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [container, uiStore])

  // Cmd/Ctrl + (+/-) to zoom the map. Off by default via config; enable with
  // `config.ui.keyboardShortcuts.mapZoom = true`. Gated to INPUT/TEXTAREA/etc.
  // so the browser's page-zoom shortcut still works in text fields.
  useEffect(() => {
    if (!cfg.ui.keyboardShortcuts.enabled) return
    if (!cfg.ui.keyboardShortcuts.mapZoom) return
    function handler(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (!isForThisEditor(e)) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      const isPlus = e.key === '+' || e.key === '='
      const isMinus = e.key === '-' || e.key === '_'
      if (!isPlus && !isMinus) return
      if (!setZoom) return
      e.preventDefault()
      const current = dataStore.getState().currentZoom
      setZoom(current + (isPlus ? 1 : -1))
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [cfg.ui.keyboardShortcuts.enabled, cfg.ui.keyboardShortcuts.mapZoom, setZoom, dataStore])

  useEffect(() => {
    // With shortcuts off, Enter still finishes the shape being drawn: it is part
    // of drawing (like Escape/Backspace in the adapters' DrawingLayer), and the
    // drawing toolbar's Finish button advertises it.
    const shortcutsOn = cfg.ui.keyboardShortcuts.enabled

    function handleKeyDown(e: KeyboardEvent) {
      if (!shortcutsOn && e.key !== 'Enter') return
      if (!isForThisEditor(e)) return
      const ds = dataStore.getState()
      const us = uiStore.getState()
      // Readonly: shortcuts that change data or start editing do nothing; viewing ones
      // (select, copy, export, measure, panels) still work, like the toolbar.
      const ro = us.readonly
      const flash = (id: string) => flashShortcutButton(scopes.get(uiStore)?.root ?? document, id)

      const tag = (e.target as HTMLElement).tagName
      const el = e.target as HTMLElement
      // Use composedPath() — e.target can be detached by the time bubble-phase runs
      // (react-data-grid re-renders the cell synchronously on keydown, so
      // el.closest() returns null even though the cell *was* inside the grid).
      const path = e.composedPath() as EventTarget[]
      const inGridByPath = path.some((n) => {
        if (!(n instanceof Element)) return false
        const role = n.getAttribute('role')
        return role === 'grid' || role === 'treegrid'
      })
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || el.isContentEditable
        || inGridByPath

      // Undo: Cmd+Z (Mac) or Ctrl+Z (Win/Linux). Skip when focus is in a text
      // field — the browser's native text-undo handles those, and we don't
      // want to also rip a feature edit out of the user's history.
      // `key.toLowerCase()` because Shift+Z reports `e.key === 'Z'` in real
      // browsers (even though Playwright sends lowercase) — without this the
      // redo branch never fires and Cmd+Shift+Z falls through to the browser.
      const keyLower = e.key.toLowerCase()
      if (!inInput && !ro && keyLower === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        flash('undo')
        if (ds.undoStack.length > 0) {
          ds.undo()
          emit({ type: 'undo' })
        }
        return
      }

      // Redo: Cmd+Shift+Z or Ctrl+Shift+Z (same gating).
      if (!inInput && !ro && keyLower === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        flash('redo')
        if (ds.redoStack.length > 0) {
          ds.redo()
          emit({ type: 'redo' })
        }
        return
      }

      // Select all visible features on the map: Cmd+A (Mac) / Ctrl+A (Win/Linux)
      // preventDefault stops the browser's "select all UI text" side effect.
      // Respects `inInput`, so typing in a field still selects field text normally.
      if (!inInput && (e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        const hiddenGroups = new Set(ds.groups.filter((g) => g.hidden).map((g) => g.id))
        const ids = ds.features
          .filter((f) => !f.hidden && !(f.groupId && hiddenGroups.has(f.groupId)))
          .map((f) => f.id)
        if (ids.length > 0) ds.setSelection(ids)
        return
      }

      // Cmd/Ctrl + J — toggle "Return to select after each shape" (sticky tool).
      // Same setting as the Settings toggle; toast describes the future
      // behavior the user will see, so they know what to expect on their NEXT
      // shape, not just which switch flipped.
      if (!inInput && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        const next = !us.autoExitAfterDraw
        us.setAutoExitAfterDraw(next)
        emit({
          type: 'success',
          message: next
            ? 'Drawing tools will exit after each shape'
            : 'Drawing tools will stay active after each shape',
          description: next
            ? 'You’ll go back to select mode. Press a tool key to draw again.'
            : 'Keep drawing more shapes in a row. Press the tool key again or Esc to exit.',
        })
        return
      }

      // Cmd/Ctrl + O — open a file picker and import GeoJSON. preventDefault
      // suppresses the browser's "Open File" dialog.
      if (!inInput && !ro && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        // Same import as dropping a file on the map: replace, one undo step, fit to the data.
        void pickGeoJSONFile().then((file) => { if (file) void importFile(file) })
        return
      }

      // Cmd/Ctrl + S — export the current FeatureCollection as a downloadable
      // .geojson file. preventDefault suppresses the browser's "Save Page" dialog.
      // Toast fires ONLY when we can confirm the user actually saved (Chromium's
      // showSaveFilePicker resolves). For Firefox / Safari we fall back to the
      // legacy `<a download>` flow silently — see saveGeoJSONFile for the
      // no-pre-mature-toast contract.
      if (!inInput && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        const json = ds.exportGeoJSON()
        const fc = JSON.parse(json) as { features?: unknown[] }
        if (!Array.isArray(fc.features) || fc.features.length === 0) {
          emit({ type: 'warning', message: 'Export failed', description: 'No features to export — draw or import something first.' })
          return
        }
        const count = fc.features.length
        ;(async () => {
          const result = await saveGeoJSONFile(json)
          if (!result) return  // user cancelled, or legacy fallback (no confirmation available)
          emit({
            type: 'success',
            message: `Exported ${result.name}`,
            description: `${count === 1 ? '1 feature' : `${count} features`} · ${(result.bytes / 1024).toFixed(1)} KB`,
          })
        })()
        return
      }

      // Copy, Paste, Duplicate
      if (!inInput && (e.metaKey || e.ctrlKey)) {
        if (e.key === 'c') {
          if (ds.selectedIds.length === 0) return
          // The internal copy always works; say so honestly when the system clipboard was refused.
          void ds.copySelection().then((ok) => emit(ok
            ? { type: 'selection:copied' }
            : { type: 'warning', message: 'Copied for pasting in this editor only', description: 'The browser did not allow writing to the system clipboard.' }))
          return
        }
        if (e.key === 'd') {
          e.preventDefault() // prevent browser bookmarking
          if (ro) return
          flash('duplicate')
          const prevIds = ds.selectedIds
          if (ds.duplicateSelection()) {
            if (prevIds.length === 1) {
              const f = dataStore.getState().features.find((feat) => feat.id === prevIds[0])
              emit({ type: 'feature:duplicated', featureId: prevIds[0], label: String(f?.properties.name || 'feature') })
            } else {
              emit({ type: 'features:duplicated', count: prevIds.length })
            }
          }
          return
        }
        // Cmd+E: open the edit/detail side panel for the single selected feature
        // and put focus straight on the first field — keyboard-only flow doesn't
        // need an extra Tab to reach the form.
        if (e.key === 'e' || e.key === 'E') {
          if (ds.selectedIds.length !== 1) return
          e.preventDefault()
          us.openEditDialog(ds.selectedIds[0], { focusFirstField: true })
          return
        }
        // Cmd+G: group selected features. Cmd+Shift+G: ungroup.
        // Browsers map Cmd+G to "Find next" (no-op without Find), so this only
        // hijacks it when the user has a selection / a grouped feature focused.
        if ((e.key === 'g' || e.key === 'G') && !ro) {
          if (e.shiftKey) {
            if (ds.selectedIds.length === 0) return
            const someGrouped = ds.features.some((f) => ds.selectedIds.includes(f.id) && f.groupId)
            if (!someGrouped) return
            e.preventDefault()
            ds.ungroupSelection()
          } else {
            if (ds.selectedIds.length === 0) return
            e.preventDefault()
            const newId = ds.groupSelection()
            if (newId) us.setAutoFocusGroupId(newId)
          }
          return
        }
      }


      // Enter / Cmd+Enter — finish line/polygon/route drawing
      if (e.key === 'Enter') {
        const canFinishDrawing = (!inInput || e.metaKey || e.ctrlKey)
        // If drawing tools are active, Enter should finish drawing even if the side panel is open.
        // Side panel uses Cmd+Enter to save, but we short-circuit that in the SidePanel if a tool is active.
        if (canFinishDrawing && us.editingMode !== 'none') {
          // Only intercept Enter for tools that have something in progress.
          // If the tool is active but the canvas is empty (just committed),
          // fall through to vertex-edit below.
          if (us.editingMode === 'slice-shape') { e.preventDefault(); us.commitSliceShape(); return }
          else if (us.editingMode === 'cut-hole') { e.preventDefault(); us.commitCutHole(); return }
          else if (us.editingMode === 'draw-line' && us.lineInProgress.length >= 2) { e.preventDefault(); us.commitLine({}); return }
          else if (us.editingMode === 'draw-polygon' && us.polygonInProgress.length >= 3) { e.preventDefault(); us.commitPolygon({}); return }
          else if (us.editingMode === 'draw-route' && us.routeWaypoints.length >= 2) { e.preventDefault(); us.commitRoute(); return }
        }
        if (!shortcutsOn) return

        // Enter with a single selection toggles vertex edit. Leaflet's FIL has
        // its own capture-phase handler that pre-empts this for its own state
        // machine; this path is what maplibre consumers hit.
        // One-shot tools and multi-click tools with nothing in progress all fall
        // through here so Enter enters vertex-edit after a shape is committed.
        const isIdleOrOneShotTool = us.editingMode === 'none' ||
          us.editingMode === 'draw-rect' || us.editingMode === 'draw-circle' ||
          us.editingMode === 'place-point' || us.editingMode === 'draw-freehand' || us.editingMode === 'pick-shape' ||
          (us.editingMode === 'draw-line' && us.lineInProgress.length < 2) ||
          (us.editingMode === 'draw-polygon' && us.polygonInProgress.length < 3) ||
          (us.editingMode === 'draw-route' && us.routeWaypoints.length < 2)
        // Don't hijack Enter while the edit/detail dialog is open — the user
        // is interacting with form fields, section toggles (Source, Coords),
        // or the Save button, and the focused element should handle Enter
        // itself (toggle, copy, submit).
        if (us.dialogState.type !== 'closed') {
          // fall through, no return — let other branches/handlers run
        }
        // Enter on a focused button/link activates it; preventDefault here would swallow that.
        else if (!inInput && !ro && !el.closest?.('button, a[href], [role="button"]') && !e.metaKey && !e.ctrlKey && !e.altKey && isIdleOrOneShotTool) {
          const sel = ds.selectedIds
          if (sel.length === 1) {
            const feature = ds.features.find((f) => f.id === sel[0])
            const t = feature?.geometry.type
            const eligible = t === 'LineString' || t === 'Polygon' ||
              t === 'MultiLineString' || t === 'MultiPolygon' || t === 'GeometryCollection'
            if (eligible) {
              e.preventDefault()
              // Exit any active drawing tool *before* entering vertex edit.
              // Without this the adapter's FeatureInteractionLayer bails out
              // (it gates its render on `editingMode === 'none'`), so the
              // VertexEditor never mounts even though vertexEditActive is
              // true. Mirrors leaflet's capture-phase Enter handler in FIL.
              const enteringEdit = !us.vertexEditActive
              if (enteringEdit && us.editingMode !== 'none') us.setEditingMode('none')
              us.setVertexEditActive(enteringEdit)
              return
            }
          }
        }
      }

      // Tab / Shift+Tab — jump between layers. Skip when:
      //   • the edit/detail dialog is open (panel handles its own focus order)
      //   • the search popover is open and Tab originated inside it (popover
      //     should walk its own result buttons natively).
      const inSearchPopover = path.some((n) => n instanceof Element && n.hasAttribute('data-elm-search-open'))
      if (e.key === 'Tab' && !inInput && us.dialogState.type === 'closed' && !inSearchPopover && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const allFeatures = ds.features
        if (allFeatures.length === 0) return
        e.preventDefault()

        const visualIds = getVisualFeatureOrder(allFeatures, ds.groups)
        const currentId = ds.selectedIds.length === 1 ? ds.selectedIds[0] : null
        const currentIdx = currentId ? visualIds.indexOf(currentId) : -1
        let nextIdx: number
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? visualIds.length - 1 : currentIdx - 1
        } else {
          nextIdx = currentIdx >= visualIds.length - 1 ? 0 : currentIdx + 1
        }
        const nextId = visualIds[nextIdx]
        ds.selectFeature(nextId)
        const feature = allFeatures.find((f) => f.id === nextId)
        if (feature) {
          if (feature.geometry.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates as [number, number]
            panTo?.([lat, lng])
          } else {
            fitBounds?.(feature.bbox || getGeometryBBox(feature.geometry))
          }
        }
        return
      }

      // Toggle shortcuts window — works regardless of dialog/input state
      if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === getCurrentKey('show-shortcuts')) { e.preventDefault(); flash('show-shortcuts'); us.shortcutsModalOpen ? us.closeShortcutsModal() : us.openShortcutsModal(); return }
        if (cfg.ui.schemaEditor && !ro && k === getCurrentKey('toggle-schema')) { e.preventDefault(); flash('toggle-schema'); us.toggleSchemaModal(); return }
        if (cfg.ui.layerList && k === getCurrentKey('toggle-sidebar')) { e.preventDefault(); flash('toggle-sidebar'); us.setSidebarOpen(!us.sidebarOpen); return }
      }

      // P / L shortcuts — ignored when typing in a field or a dialog is open
      if (!inInput && us.dialogState.type !== 'new-point' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (cfg.ui.dataTable && k === getCurrentKey('toggle-table')) { e.preventDefault(); flash('toggle-table'); us.toggleTable(); return }
        if (cfg.ui.geojsonEditor && k === getCurrentKey('toggle-geojson')) { e.preventDefault(); flash('toggle-geojson'); us.toggleCodeModal(); return }
        if (cfg.ui.zoomIndicator && k === getCurrentKey('set-zoom')) { e.preventDefault(); flash('set-zoom'); us.setZoomEditing(true); return }
        if (k === getCurrentKey('measure')) { flash('measure'); us.setEditingMode(us.editingMode === 'measure' ? 'none' : 'measure'); return }
        if (ro) return
        if (k === getCurrentKey('toggle-transform')) {
          if ((ds.selectedIds.length === 1 ? ds.selectedIds[0] : null) || ds.selectedIds.length > 0) {
            flash('toggle-transform')
            us.setTransformActive(!us.transformActive)
            if (!us.transformActive && us.editingMode !== 'none') {
              us.setEditingMode('none')
            }
          }
          return
        }
        const toolEnabled = us.isToolAvailable
        // Toggle a tool that adds a feature. Like the toolbar, refuse to turn it
        // on at the `maxFeatures` limit (canAddFeatures reports the message).
        const toggleAddTool = (mode: EditingMode) => {
          if (us.editingMode !== mode && !ds.canAddFeatures(1)) return
          flash(mode === 'pick-shape' ? 'picker' : mode)
          us.setEditingMode(us.editingMode === mode ? 'none' : mode)
        }
        for (const tool of ADD_TOOLS) {
          const mode = TOOL_MODES[tool]
          // Each tool's shortcut id is its mode, except the picker's.
          if (toolEnabled(tool) && k === getCurrentKey(mode === 'pick-shape' ? 'picker' : mode)) { toggleAddTool(mode); return }
        }
        if (k === getCurrentKey('cut-hole')) {
          const target = ds.features.find(f => f.id === (ds.selectedIds.length === 1 ? ds.selectedIds[0] : null))
          if (target && (target.geometry.type === 'Polygon' || target.geometry.type === 'MultiPolygon')) {
            flash('cut-hole')
            us.setEditingMode(us.editingMode === 'cut-hole' ? 'none' : 'cut-hole')
            us.setTransformActive(false)
          }
          return
        }
        if (k === getCurrentKey('slice-shape')) {
          const target = ds.features.find(f => f.id === (ds.selectedIds.length === 1 ? ds.selectedIds[0] : null))
          if (target && (target.geometry.type === 'Polygon' || target.geometry.type === 'MultiPolygon')) {
            flash('slice-shape')
            us.setEditingMode(us.editingMode === 'slice-shape' ? 'none' : 'slice-shape')
            us.setTransformActive(false)
          }
          return
        }
        if (k === getCurrentKey('break-apart')) {
          const targetId = ds.selectedIds.length === 1 ? ds.selectedIds[0] : null
          const target = targetId ? ds.features.find(f => f.id === targetId) : null
          if (target && isMultiGeometry(target.geometry)) {
            flash('break-apart')
            const count = getPartCount(target.geometry)
            if (ds.breakMultiGeometry(targetId!)) emit({ type: 'feature:broken', featureId: targetId!, count, undo: () => dataStore.getState().undo() })
          }
          return
        }
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (ro) return
      if (us.dialogState.type === 'new-point') return

      const ids = ds.selectedIds
      if (ids.length === 0) return
      if (inInput) return
      if (us.vertexEditActive) return

      const count = ids.length
      const feature = count === 1 ? ds.features.find((f) => f.id === ids[0]) : null
      const name = count === 1 ? String(feature?.properties.name || 'Unnamed feature') : `${count} features`

      // adapter-leaflet's FeatureInteractionLayer attaches a fallback Delete
      // listener to the same window — without stopImmediatePropagation it
      // fires a second deleteSelection. That used to be a no-op (selectedIds
      // was [] after the first delete), but with auto-select-next the first
      // delete leaves a new selection that the second listener would then
      // remove. stopImmediatePropagation blocks sibling listeners on `window`.
      e.preventDefault()
      e.stopImmediatePropagation()
      flash('delete-selected')

      ds.deleteSelection()
      us.closeDialog()

      if (count === 1) {
        emit({ type: 'feature:deleted', featureId: ids[0], label: name, undo: () => dataStore.getState().undo() })
      } else {
        emit({ type: 'features:deleted', count, undo: () => dataStore.getState().undo() })
      }
    }

    function handlePaste(e: ClipboardEvent) {
      if (!isForThisEditor(e)) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (uiStore.getState().readonly) return

      const text = e.clipboardData?.getData('text')
      if (text) {
        try {
          const parsed = JSON.parse(text)
          if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature') {
            const featuresToPaste = parsed.type === 'FeatureCollection' ? parsed.features : [parsed]

            // Bypass importGeoJSON to ensure pasted features are ALWAYS added as copies (new UUIDs, offset)
            // even if they exist in the store. We reuse cloneFeature logic by calling an action or mapping.
            // But cloneFeature is internal to DataStore!
            // Better: update the store clipboard with these features and call pasteSelection!
            dataStore.setState({ clipboard: featuresToPaste })
            if (dataStore.getState().pasteSelection()) emit({ type: 'selection:pasted', count: featuresToPaste.length })
            return
          }
        } catch (e) { /* ignore parse error */ }
      }

      // If it wasn't valid GeoJSON, fall back to internal clipboard
      const clip = dataStore.getState().clipboard
      if (clip && clip.length > 0 && dataStore.getState().pasteSelection()) {
        emit({ type: 'selection:pasted', count: clip.length })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handlePaste)
    }
  }, [dataStore, uiStore, emit, panTo, fitBounds, cfg, getCurrentKey, importFile])

  // Escape: priority order — close dialog → yield to active drawing/measure tool →
  // exit in-feature tool (vertex edit / transform) → deselect. Tool exits keep the feature
  // selected so users can immediately re-enter or pick a different tool.
  // Registered in capture phase so it fires before useSearchState's capture-phase handler
  // which calls stopPropagation on Escape. Uses getState() to always read fresh values.
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Not ours (host modal, host button, the other editor): never act and
      // never stopPropagation, or the host's own Escape would be swallowed.
      if (!isForThisEditor(e)) return
      const target = e.target as HTMLElement | null
      // Don't intercept inputs — let them handle Escape natively (blur, close popover, etc.)
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      // Inside a floating window (shortcuts, settings, schema): the window closes itself (useWindowEscape).
      if (target?.closest?.(`[${WINDOW_ATTR}]`)) return

      // Yield to any open <ContextMenu> — its own ESC handler closes it.
      // Capture-phase ordering follows registration order, so this listener
      // (registered at app mount) runs before the menu's and would clear
      // selection on the same press without this early return.
      if (isContextMenuOpen()) return

      const us = uiStore.getState()
      const ds = us.dialogState
      if (ds.type !== 'closed') {
        us.closeDialog()
        e.stopPropagation()
        return
      }
      // Yield to drawing/measure tools — DrawingLayer/MeasureLayer have their own ESC
      // handlers that cancel the in-progress geometry. Don't deselect or stop propagation.
      if (us.editingMode !== 'none') return

      if (us.vertexEditActive) {
        us.setVertexEditActive(false)
        e.stopPropagation()
        return
      }
      if (us.transformActive) {
        us.setTransformActive(false)
        e.stopPropagation()
        return
      }
      if (dataStore.getState().selectedIds.length > 0) {
        dataStore.getState().selectFeature(null)
        e.stopPropagation()
        return
      }
      // Nothing else to cancel: close the top floating window (e.g. the
      // shortcuts panel opened with K, focus still on the map).
      if (closeTopWindow(uiStore)) e.stopPropagation()
    }
    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => window.removeEventListener('keydown', handleEscape, { capture: true })
  }, [])
}
