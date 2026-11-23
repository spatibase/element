import { useCallback, useRef, useState } from 'react'
import { useWindowEscape, WINDOW_ATTR } from '../../hooks/useWindowEscape'
import { isMacPlatform } from '../../utils/platform'
import { useElementEditorConfig } from '../../contexts/ElementEditorConfigContext'
import { readStorage, writeStorage } from '@element-editor/core'
import { GlobeHemisphereWest, Monitor, Sun, Moon, Desktop } from '@phosphor-icons/react'
import { useDataStore, useUIStore } from '../../store/StoreContext'
import { CloseButton } from '../ui/CloseButton'
import { useTheme } from '../../contexts/ThemeContext'
import { useDragWindow } from '../../hooks/useDragWindow'
import { startDragShield } from '../../hooks/dragShield'
import { useWindowFocus } from '../../hooks/useWindowFocus'

const SIZE_KEY = 'elm_settings_win_size'
const MIN_W = 320
const MIN_H = 320
const DEFAULT_SIZE = { w: 384, h: 560 }

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsModalOpen)
  const setOpen = useUIStore((s) => s.setSettingsModalOpen)
  const geometryMode = useDataStore((s) => s.geometryMode)
  const setGeometryMode = useDataStore((s) => s.setGeometryMode)
  const setShowMeasurements = useUIStore((s) => s.setShowMeasurements)
  const showMeasurements = useUIStore((s) => s.showMeasurements)
  const showFeatureNameOnHover = useUIStore((s) => s.showFeatureNameOnHover)
  const setShowFeatureNameOnHover = useUIStore((s) => s.setShowFeatureNameOnHover)
  const topoEditEnabled = useUIStore((s) => s.topoEditEnabled)
  const setTopoEditEnabled = useUIStore((s) => s.setTopoEditEnabled)
  const autoExitAfterDraw = useUIStore((s) => s.autoExitAfterDraw)
  const autoExitLocked = useUIStore((s) => s.autoExitLocked)
  const setAutoExitAfterDraw = useUIStore((s) => s.setAutoExitAfterDraw)
  const snapEnabled = useUIStore((s) => s.snapEnabled)
  const setSnapEnabled = useUIStore((s) => s.setSnapEnabled)
  const userTheme = useUIStore((s) => s.userTheme)
  const setUserTheme = useUIStore((s) => s.setUserTheme)
  const themeMode = useTheme()

  const { pos, onHandleMouseDown } = useDragWindow('elm_settings_win', { x: 80, y: 80 })

  const persistScope = useElementEditorConfig()
  const { zIndex, focus } = useWindowFocus(open)

  const winRef = useRef<HTMLDivElement>(null)
  useWindowEscape(winRef, open, () => setOpen(false), zIndex)
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const r = readStorage(SIZE_KEY, persistScope)
      return r ? (JSON.parse(r) as { w: number; h: number }) : DEFAULT_SIZE
    } catch { return DEFAULT_SIZE }
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

  if (!open) return null

  return (
    <div
      ref={winRef}
      {...{ [WINDOW_ATTR]: '' }}
      role="dialog"
      aria-label="Settings"
      onMouseDownCapture={focus}
      className="fixed flex flex-col bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-raised rounded-elm-window overflow-hidden"
      data-elm-theme={themeMode}
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
      {/* Title bar — drag handle. Title styled to match ShortcutsModal. */}
      <div
        onMouseDown={onHandleMouseDown}
        className="flex items-center justify-between px-4 py-3 border-b border-elm-border flex-shrink-0 select-none"
        style={{ cursor: 'grab' }}
      >
        <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100))">Settings</span>
        <CloseButton onClick={() => setOpen(false)} label="Close settings" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 min-h-0">

        {/* Theme */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-elm-text-secondary">Appearance</h3>
          <div className="flex rounded-elm border border-elm-border overflow-hidden">
            {([
              { value: 'light',  label: 'Light',  Icon: Sun },
              { value: 'dark',   label: 'Dark',   Icon: Moon },
              { value: 'system', label: 'Auto',   Icon: Desktop },
            ] as const).map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setUserTheme(value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                  userTheme === value
                    ? 'bg-primary-500 hover:bg-primary-600 text-white'
                    : 'text-elm-text-muted hover:bg-elm-surface-hover hover:text-(--elm-text-secondary,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-200))'
                }`}
              >
                <Icon size={14} weight={userTheme === value ? 'fill' : 'regular'} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Drawing mode (visual / spatial) */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-elm-text-secondary">Drawing mode</h3>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setGeometryMode('visual')}
              className={`p-3 text-center rounded-elm border text-sm transition-colors ${
                geometryMode === 'visual'
                  ? 'border-primary-500 bg-primary-50 dark:bg-white/5 hover:bg-primary-100 dark:hover:bg-white/10 ring-1 ring-primary-500/20'
                  : 'border-(--elm-border,var(--color-gray-200)) dark:border-(--elm-border,var(--color-gray-600)) bg-elm-surface-raised hover:border-(--elm-border-strong,var(--color-gray-300)) dark:hover:border-(--elm-border-strong,var(--color-gray-500)) hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,color-mix(in_oklab,var(--color-gray-700)_50%,transparent))'
              }`}
            >
              <Monitor size={32} weight={geometryMode === 'visual' ? 'fill' : 'regular'} className={`mx-auto mb-2 ${geometryMode === 'visual' ? 'text-primary-600' : 'text-elm-text-muted'}`} />
              <span className={`block mb-1 font-semibold ${geometryMode === 'visual' ? 'text-primary-800 dark:text-primary-300' : 'text-(--elm-text-secondary,var(--color-gray-700)) dark:text-(--elm-text-secondary,var(--color-gray-200))'}`}>Visual</span>
              <p className="text-xs leading-relaxed text-elm-text-muted">Shapes keep their proportions on screen. Best for sketching and layouts.</p>
            </button>

            <button
              onClick={() => setGeometryMode('spatial')}
              className={`p-3 text-center rounded-elm border text-sm transition-colors ${
                geometryMode === 'spatial'
                  ? 'border-primary-500 bg-primary-50 dark:bg-white/5 hover:bg-primary-100 dark:hover:bg-white/10 ring-1 ring-primary-500/20'
                  : 'border-(--elm-border,var(--color-gray-200)) dark:border-(--elm-border,var(--color-gray-600)) bg-elm-surface-raised hover:border-(--elm-border-strong,var(--color-gray-300)) dark:hover:border-(--elm-border-strong,var(--color-gray-500)) hover:bg-(--elm-surface-hover,var(--color-gray-50)) dark:hover:bg-(--elm-surface-hover,color-mix(in_oklab,var(--color-gray-700)_50%,transparent))'
              }`}
            >
              <GlobeHemisphereWest size={32} weight={geometryMode === 'spatial' ? 'fill' : 'regular'} className={`mx-auto mb-2 ${geometryMode === 'spatial' ? 'text-primary-600' : 'text-elm-text-muted'}`} />
              <span className={`block mb-1 font-semibold ${geometryMode === 'spatial' ? 'text-primary-800 dark:text-primary-300' : 'text-(--elm-text-secondary,var(--color-gray-700)) dark:text-(--elm-text-secondary,var(--color-gray-200))'}`}>Spatial</span>
              <p className="text-xs leading-relaxed text-elm-text-muted">Shapes keep their true size on the ground. Best for exact areas and distances.</p>
            </button>
          </div>
        </div>

        {/* Show measurements */}
        <div className="pt-4 border-t border-elm-border-subtle">
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100))">Show measurements</span>
              <span className="text-xs text-elm-text-muted">Display live dimensions and coordinates at the cursor while drawing shapes.</span>
            </div>
            <div className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-elm-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-elm-surface ${showMeasurements ? 'bg-primary-500' : 'bg-(--elm-border-strong,var(--color-gray-200)) dark:bg-(--elm-border-strong,var(--color-gray-600))'}`}>
              <span className={`${showMeasurements ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
              <input
                type="checkbox"
                className="sr-only"
                checked={showMeasurements}
                onChange={(e) => setShowMeasurements(e.target.checked)}
              />
            </div>
          </label>
        </div>

        {/* Show name on hover (hidden when config.featureTooltip is false) */}
        {persistScope.featureTooltip.enabled && (
          <div className="pt-4 border-t border-elm-border-subtle">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100))">Show name on hover</span>
                <span className="text-xs text-elm-text-muted">Display the feature name when hovering over shapes on the map.</span>
              </div>
              <div className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-elm-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-elm-surface ${showFeatureNameOnHover ? 'bg-primary-500' : 'bg-(--elm-border-strong,var(--color-gray-200)) dark:bg-(--elm-border-strong,var(--color-gray-600))'}`}>
                <span className={`${showFeatureNameOnHover ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showFeatureNameOnHover}
                  onChange={(e) => setShowFeatureNameOnHover(e.target.checked)}
                />
              </div>
            </label>
          </div>
        )}

        {/* Topological editing */}
        <div className="pt-4 border-t border-elm-border-subtle">
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100))">Topological editing</span>
              <span className="text-xs text-elm-text-muted">When editing points, shared borders between areas update together. Hold {isMacPlatform() ? '⌘ Cmd' : 'Ctrl'} to temporarily disable.</span>
            </div>
            <div className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-elm-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-elm-surface ${topoEditEnabled ? 'bg-primary-500' : 'bg-(--elm-border-strong,var(--color-gray-200)) dark:bg-(--elm-border-strong,var(--color-gray-600))'}`}>
              <span className={`${topoEditEnabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
              <input
                type="checkbox"
                className="sr-only"
                checked={topoEditEnabled}
                onChange={(e) => setTopoEditEnabled(e.target.checked)}
              />
            </div>
          </label>
        </div>

        {/* Snapping */}
        <div className="pt-4 border-t border-elm-border-subtle">
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100))">Snapping</span>
              <span className="text-xs text-elm-text-muted">Snap to nearby points and edges while drawing. Hold {isMacPlatform() ? '⌘ Cmd' : 'Ctrl'} to temporarily disable.</span>
            </div>
            <div className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-elm-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-elm-surface ${snapEnabled ? 'bg-primary-500' : 'bg-(--elm-border-strong,var(--color-gray-200)) dark:bg-(--elm-border-strong,var(--color-gray-600))'}`}>
              <span className={`${snapEnabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
              <input
                type="checkbox"
                className="sr-only"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
            </div>
          </label>
        </div>

        {/* Return to select after each shape — placed last so it's the most
            findable workflow toggle. */}
        <div className="pt-4 border-t border-elm-border-subtle">
          <label className={`flex items-center justify-between group ${autoExitLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-semibold text-(--elm-text,var(--color-gray-800)) dark:text-(--elm-text,var(--color-gray-100))">Return to select after each shape</span>
              <span className="text-xs text-elm-text-muted">Drawing tools deactivate after every shape, so you go back to selection. Turn off to keep the tool active and draw multiple shapes in a row.{autoExitLocked ? ' Set by the app, so it can’t be changed here.' : ''}</span>
            </div>
            <div className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-elm-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-elm-surface ${autoExitAfterDraw ? 'bg-primary-500' : 'bg-(--elm-border-strong,var(--color-gray-200)) dark:bg-(--elm-border-strong,var(--color-gray-600))'}`}>
              <span className={`${autoExitAfterDraw ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
              <input
                type="checkbox"
                className="sr-only"
                checked={autoExitAfterDraw}
                disabled={autoExitLocked}
                onChange={(e) => setAutoExitAfterDraw(e.target.checked)}
              />
            </div>
          </label>
        </div>
      </div>

      {/* Resize handle (matches ShortcutsModal). */}
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
