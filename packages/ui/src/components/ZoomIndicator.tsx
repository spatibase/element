import { useEffect, useRef, useState } from 'react'
import { useDataStore, useUIStore } from '../store/StoreContext'
import { useMapController } from '../contexts/MapControllerContext'
import { useEmit } from '../contexts/EventContext'
import { useShortcutConfig } from '../contexts/ShortcutConfigContext'
import { Tooltip, type TooltipSide } from './ui/Tooltip'
import { KbdDark } from './ui/Kbd'

interface Props {
  /** Inclusive lower bound for the zoom input. Default 1. */
  minZoom?: number
  /** Inclusive upper bound for the zoom input. Default 22 (Leaflet/MapLibre standard). */
  maxZoom?: number
  /** Show one decimal place and accept fractional input. For MapLibre which supports sub-integer zoom. */
  fractional?: boolean
  /** `'sm'`: compact flat text for the status bar. `'group'`: flat, inside a joined pill. Default `'md'`. */
  size?: 'md' | 'sm' | 'group'
  /** Tooltip side. Default `'top'`. */
  tooltipSide?: TooltipSide
}

const smClasses =
  'flex items-center justify-center h-6 min-w-6 px-1.5 rounded-elm-control bg-transparent border border-transparent text-elm-text font-elm-mono text-xs tabular-nums select-none transition-colors focus-visible:ring-2 focus-visible:ring-elm-focus-ring'

const groupClasses =
  'flex items-center justify-center h-8 min-w-8 px-1 rounded-elm-control bg-transparent border border-transparent text-elm-text font-elm-mono text-sm tabular-nums select-none transition-colors'

const mdClasses =
  'flex items-center justify-center w-12 h-12 bg-elm-surface/95 backdrop-blur-md border border-elm-border/80 shadow-elm-control rounded-elm text-elm-text font-elm-mono text-sm select-none transition-colors'

export default function ZoomIndicator({ minZoom = 1, maxZoom = 22, fractional = false, size = 'md', tooltipSide = 'top' }: Props) {
  const zoom = useDataStore((s) => s.currentZoom)
  const { flyTo, getCenter } = useMapController()
  const emit = useEmit()
  const interactive = !!flyTo && !!getCenter

  // editing state is shared with the keyboard-shortcut handler (Z key)
  // so pressing Z from anywhere opens this input.
  const editing = useUIStore((s) => s.zoomEditing)
  const setEditing = useUIStore((s) => s.setZoomEditing)
  const [pendingZoom, setPendingZoom] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Opened by a click → caret at the end, nothing selected. Opened by the Z
  // shortcut → select all so typing replaces the number.
  const openedByClickRef = useRef(false)
  const { getKey } = useShortcutConfig()
  const baseClasses = size === 'sm' ? smClasses : size === 'group' ? groupClasses : mdClasses
  const flat = size !== 'md'

  useEffect(() => {
    if (pendingZoom === null) return
    if (fractional ? Math.abs(zoom - pendingZoom) < 0.05 : Math.round(zoom) === Math.round(pendingZoom)) setPendingZoom(null)
  }, [zoom, pendingZoom, fractional])

  function commit() {
    const trimmed = (inputRef.current?.value ?? '').trim()
    if (trimmed === '') { setEditing(false); return }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      emit({ type: 'warning', message: `"${trimmed}" is not a valid zoom level` })
      return
    }
    if (parsed < minZoom || parsed > maxZoom) {
      emit({ type: 'warning', message: `Zoom must be between ${minZoom} and ${maxZoom}` })
      return
    }
    if (!flyTo || !getCenter) {
      emit({ type: 'warning', message: 'Map is not ready yet — try again in a moment' })
      return
    }
    const center = getCenter()
    // getCenter returns [lng, lat]; flyTo expects [lat, lng]
    setPendingZoom(parsed)
    flyTo([center[1], center[0]], parsed)
    setEditing(false)
  }

  if (editing) {
    // Uncontrolled input: we want the value to be correct on FIRST paint so
    // autoFocus + onFocus caret/select (see openedByClickRef) sees the number. A
    // controlled `value={state}` would render empty for one frame (state
    // starts as "") — autoFocus would then select nothing. `defaultValue`
    // + `inputRef.current.value` for commit avoids that render gap.
    const initial = fractional ? (pendingZoom ?? zoom).toFixed(1) : String(Math.round(pendingZoom ?? zoom))
    return (
      <input
        ref={inputRef}
        // `type="text"` + `inputMode="numeric"`: Chromium's `input.select()`
        // is unreliable on `type="number"`. Text gives reliable selection;
        // inputMode keeps the mobile keypad numeric.
        type="text"
        inputMode={fractional ? 'decimal' : 'numeric'}
        pattern={fractional ? '[0-9.]*' : '[0-9]*'}
        autoFocus
        defaultValue={initial}
        onFocus={(e) => {
          const el = e.currentTarget
          if (openedByClickRef.current) el.setSelectionRange(el.value.length, el.value.length)
          else el.select()
          openedByClickRef.current = false
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        onBlur={() => setEditing(false)}
        aria-label="Zoom level"
        className={`${baseClasses.replace(' select-none', '')} text-center focus:outline-none focus:border-elm-focus-ring${flat ? ' w-10 !bg-elm-surface' : ''}`}
      />
    )
  }

  return (
    <Tooltip
      content={interactive ? 'Set zoom level' : 'Map zoom level'}
      side={tooltipSide}
      shortcut={interactive ? <KbdDark>{getKey('set-zoom').toUpperCase()}</KbdDark> : undefined}
    >
      <button
        type="button"
        aria-label={interactive ? 'Set map zoom level' : 'Map zoom level'}
        data-elm-shortcut="set-zoom"
        onClick={() => { if (!interactive) return; openedByClickRef.current = true; setEditing(true) }}
        disabled={!interactive}
        className={`${baseClasses} ${interactive ? `${flat ? 'hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-gray-200)_70%,transparent)) dark:hover:bg-(--elm-control-hover,var(--color-gray-800))' : 'hover:bg-elm-surface-hover'} focus:outline-none cursor-pointer` : 'cursor-default'}`}
      >
        {fractional ? (pendingZoom ?? zoom).toFixed(1) : Math.round(pendingZoom ?? zoom)}
      </button>
    </Tooltip>
  )
}
