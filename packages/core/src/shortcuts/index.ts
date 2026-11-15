/** All keyboard shortcut definitions for Element. */

import { readPersisted, writePersisted, type PersistScope } from '../utils/persisted'

export type ShortcutId =
  | 'place-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'draw-route'
  | 'draw-circle'
  | 'draw-rect'
  | 'draw-freehand'
  | 'picker'
  | 'measure'
  | 'cut-hole'
  | 'slice-shape'
  | 'break-apart'
  | 'toggle-table'
  | 'toggle-transform'
  | 'show-shortcuts'
  | 'toggle-geojson'
  | 'toggle-schema'
  | 'toggle-sidebar'
  | 'set-zoom'

export interface CustomizableShortcut {
  id: ShortcutId
  label: string
  category: 'drawing' | 'view' | 'editing'
  defaultKey: string  // lowercase single character
  customizable: true
}

export type FixedShortcutId =
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'delete-selected'
  | 'search-places'
  | 'finish-drawing'
  | 'cancel'
  | 'group-selection'
  | 'ungroup-selection'
  | 'edit-selected'
  | 'toggle-sticky-tool'
  | 'import-geojson'
  | 'export-geojson'

export interface FixedShortcut {
  id: FixedShortcutId
  label: string
  /** Primary key shown in toolbars/menus (e.g. "Del"). */
  display: string
  /** Additional keys that also trigger the action; rendered alongside `display` in the full docs view. */
  aliases?: string[]
  category: 'editing' | 'drawing' | 'view'
  customizable: false
}

export type AnyShortcut = CustomizableShortcut | FixedShortcut

/** Shortcuts the user can remap to a different single key. */
export const CUSTOMIZABLE_SHORTCUTS: CustomizableShortcut[] = [
  { id: 'place-point',    label: 'Place point',       category: 'drawing', defaultKey: 'p', customizable: true },
  { id: 'draw-line',      label: 'Draw line',         category: 'drawing', defaultKey: 'l', customizable: true },
  { id: 'draw-polygon',   label: 'Draw area',         category: 'drawing', defaultKey: 'g', customizable: true },
  { id: 'draw-route',     label: 'Draw route',        category: 'drawing', defaultKey: 'c', customizable: true },
  { id: 'draw-circle',    label: 'Draw circle',       category: 'drawing', defaultKey: 'o', customizable: true },
  { id: 'draw-rect',      label: 'Draw rectangle',    category: 'drawing', defaultKey: 'r', customizable: true },
  { id: 'draw-freehand',  label: 'Draw freehand',     category: 'drawing', defaultKey: 'f', customizable: true },
  { id: 'picker',         label: 'Picker',            category: 'drawing', defaultKey: 'x', customizable: true },
  { id: 'measure',        label: 'Measure',           category: 'drawing', defaultKey: 'm', customizable: true },
  { id: 'cut-hole',       label: 'Cut hole',          category: 'editing', defaultKey: 'h', customizable: true },
  { id: 'slice-shape',    label: 'Slice shape',       category: 'editing', defaultKey: 'j', customizable: true },
  { id: 'break-apart',    label: 'Break apart',       category: 'editing', defaultKey: 'b', customizable: true },
  { id: 'toggle-sidebar', label: 'Toggle layers panel',   category: 'view', defaultKey: '/', customizable: true },
  { id: 'toggle-table',   label: 'Toggle table',         category: 'view', defaultKey: 't', customizable: true },
  { id: 'toggle-geojson', label: 'Toggle GeoJSON',       category: 'view', defaultKey: 'i', customizable: true },
  { id: 'toggle-transform', label: 'Toggle transformation', category: 'editing', defaultKey: 'a', customizable: true },
  { id: 'toggle-schema',  label: 'Toggle schema editor', category: 'view', defaultKey: 's', customizable: true },
  { id: 'show-shortcuts', label: 'Toggle key shortcuts',  category: 'view', defaultKey: 'k', customizable: true },
  { id: 'set-zoom',       label: 'Set zoom level',       category: 'view', defaultKey: 'z', customizable: true },
]

/** Shortcuts that are fixed and cannot be rebound. */
export const FIXED_SHORTCUTS: FixedShortcut[] = [
  { id: 'undo',            label: 'Undo',              category: 'editing', display: '⌘ Z',   customizable: false },
  { id: 'redo',            label: 'Redo',              category: 'editing', display: '⌘ ⇧ Z', customizable: false },
  { id: 'select-all',      label: 'Select all',        category: 'editing', display: '⌘ A',   customizable: false },
  { id: 'delete-selected', label: 'Delete selected',   category: 'editing', display: 'Del',   aliases: ['⌫'], customizable: false },
  { id: 'search-places',   label: 'Search places',     category: 'view',    display: '⌘ F',   customizable: false },
  { id: 'finish-drawing',  label: 'Finish drawing',    category: 'drawing', display: '↵',     customizable: false },
  { id: 'cancel',          label: 'Cancel / Deselect', category: 'drawing', display: 'Esc',   customizable: false },
  { id: 'group-selection',   label: 'Group selection',   category: 'editing', display: '⌘ G',   customizable: false },
  { id: 'ungroup-selection', label: 'Ungroup selection', category: 'editing', display: '⌘ ⇧ G', customizable: false },
  { id: 'edit-selected',     label: 'Edit selected layer', category: 'editing', display: '⌘ E',  customizable: false },
  { id: 'toggle-sticky-tool', label: 'Toggle sticky tool', category: 'editing', display: '⌘ J',  customizable: false },
  { id: 'import-geojson',    label: 'Import GeoJSON file', category: 'view',    display: '⌘ O',  customizable: false },
  { id: 'export-geojson',    label: 'Export GeoJSON file', category: 'view',    display: '⌘ S',  customizable: false },
]

/** Primary key label for a fixed shortcut (e.g. "Del"). Use in toolbars and context menus. */
export function getFixedShortcutDisplay(id: FixedShortcutId): string {
  const s = FIXED_SHORTCUTS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown fixed shortcut: ${id}`)
  return s.display
}

/** Full docs label including aliases (e.g. "Del / ⌫"). Use in the shortcuts modal. */
export function getFixedShortcutFullDisplay(id: FixedShortcutId): string {
  const s = FIXED_SHORTCUTS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown fixed shortcut: ${id}`)
  return s.aliases?.length ? [s.display, ...s.aliases].join(' / ') : s.display
}

export const STORAGE_KEY = 'elm_shortcuts'
const SHORTCUTS_VERSION = 1

/** Load saved custom bindings from localStorage. */
export function loadCustomBindings(scope?: PersistScope): Partial<Record<ShortcutId, string>> {
  const stored = readPersisted<Partial<Record<ShortcutId, string>>>(
    STORAGE_KEY,
    SHORTCUTS_VERSION,
    (raw) => (raw && typeof raw === 'object' ? (raw as Partial<Record<ShortcutId, string>>) : null),
    scope,
  )
  return stored ?? {}
}

/** Persist custom bindings to localStorage. */
export function saveCustomBindings(bindings: Partial<Record<ShortcutId, string>>, scope?: PersistScope) {
  writePersisted(STORAGE_KEY, SHORTCUTS_VERSION, bindings, scope)
}

/** Get effective key for a shortcut (custom override or default). */
export function getEffectiveKey(id: ShortcutId, custom: Partial<Record<ShortcutId, string>>): string {
  return custom[id] ?? CUSTOMIZABLE_SHORTCUTS.find((s) => s.id === id)?.defaultKey ?? ''
}

/** Returns the ShortcutId that currently uses the given key, or null. */
export function findConflict(
  key: string,
  excludeId: ShortcutId,
  custom: Partial<Record<ShortcutId, string>>,
): ShortcutId | null {
  for (const s of CUSTOMIZABLE_SHORTCUTS) {
    if (s.id === excludeId) continue
    if (getEffectiveKey(s.id, custom) === key) return s.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Runtime cache — avoids reading localStorage on every keydown event.
// Fallback for code outside a ShortcutConfigProvider (which keeps per-editor
// bindings); the provider syncs it on mount and whenever bindings change.
// ---------------------------------------------------------------------------

let _cache: Partial<Record<ShortcutId, string>> = {}

export function syncShortcutCache(bindings: Partial<Record<ShortcutId, string>>) {
  _cache = bindings
}

/** Get the effective key for a shortcut using the in-memory cache. */
export function getCurrentKey(id: ShortcutId): string {
  return getEffectiveKey(id, _cache)
}
