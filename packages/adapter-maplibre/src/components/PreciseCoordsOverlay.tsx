/**
 * PreciseCoordsOverlay — small popup anchored to a coordinate for numeric
 * lng/lat entry. Used for Point features ("Precise coordinates…" menu item) and
 * for shape points in vertex edit ("Edit coordinates…"). The caller commits via
 * `onSave`. Commits on Enter or Save click; cancels on Escape or Cancel click.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEmit } from '@element-editor/ui'

interface Props {
  map: MapLibreMap
  coords: [number, number]
  /** Commit the new coordinate (take an undo snapshot first). */
  onSave: (coord: [number, number]) => void
  onClose: () => void
}

export default function PreciseCoordsOverlay({ map, coords, onSave, onClose }: Props) {
  const emit = useEmit()

  const [draftLng, setDraftLng] = useState(coords[0].toFixed(6))
  const [draftLat, setDraftLat] = useState(coords[1].toFixed(6))
  const [screen, setScreen] = useState<{ x: number; y: number }>(() => {
    const p = map.project(coords)
    return { x: p.x, y: p.y }
  })
  const firstInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const reproject = () => {
      const p = map.project(coords)
      setScreen({ x: p.x, y: p.y })
    }
    map.on('move', reproject)
    map.on('zoom', reproject)
    map.on('resize', reproject)
    return () => {
      map.off('move', reproject)
      map.off('zoom', reproject)
      map.off('resize', reproject)
    }
  }, [map, coords])

  useEffect(() => {
    firstInputRef.current?.focus()
    firstInputRef.current?.select()
  }, [])

  function commit() {
    const lng = parseFloat(draftLng)
    const lat = parseFloat(draftLat)
    if (isNaN(lng) || isNaN(lat)) {
      emit({ type: 'warning', message: 'Invalid coordinates' })
      return
    }
    onSave([lng, lat])
    emit({ type: 'success', message: 'Coordinate updated' })
    onClose()
  }

  return createPortal(
    <div
      data-elm-theme
      style={{
        position: 'absolute',
        left: screen.x,
        top: screen.y - 16,
        transform: 'translate(-50%, -100%)',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="flex flex-col gap-2 min-w-[160px] bg-(--elm-surface,var(--color-white))/95 backdrop-blur-md border border-(--elm-border-strong,var(--color-slate-300)) rounded-elm-control shadow-elm-control p-2 text-(--elm-text,var(--color-slate-800))"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') onClose()
        }}
      >
        <p className="text-xs font-semibold m-0 leading-none">Precise coordinates</p>
        <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-slate-500))">
          Lat:
          <input
            ref={firstInputRef}
            type="text"
            inputMode="decimal"
            value={draftLat}
            onChange={(e) => setDraftLat(e.target.value)}
            className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-slate-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus:border-primary-400"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-(--elm-text-muted,var(--color-slate-500))">
          Lng:
          <input
            type="text"
            inputMode="decimal"
            value={draftLng}
            onChange={(e) => setDraftLng(e.target.value)}
            className="flex-1 w-full min-w-0 border border-(--elm-border,var(--color-slate-200)) rounded-elm-chip px-1.5 py-0.5 text-xs outline-none focus:border-primary-400"
          />
        </label>
        <div className="flex items-center justify-end gap-1 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs text-(--elm-text-muted,var(--color-slate-500)) hover:bg-(--elm-surface-hover,var(--color-slate-100)) rounded-elm-chip transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            className="px-2 py-1 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-elm-chip transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    map.getCanvasContainer(),
  )
}
