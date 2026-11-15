/**
 * TextEditOverlay — absolute-positioned input anchored to a text-label feature's
 * projected coords. Shown while the user is editing a text feature's `name`.
 * Commits on Enter or blur; cancels on Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useDataStore } from '../store/StoreContext'
import type { GeoJSONFeature } from '@element-editor/core'

interface Props {
  map: MapLibreMap
  feature: GeoJSONFeature
  onDone: () => void
}

export default function TextEditOverlay({ map, feature, onDone }: Props) {
  const updateFeature = useDataStore((s) => s.updateFeature)
  const [value, setValue] = useState<string>(
    (feature.properties.name as string | undefined) ?? '',
  )
  const [screen, setScreen] = useState<{ x: number; y: number }>(() => {
    const c = feature.geometry.coordinates as [number, number]
    const p = map.project(c)
    return { x: p.x, y: p.y }
  })
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const c = feature.geometry.coordinates as [number, number]
    const reproject = () => {
      const p = map.project(c)
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
  }, [map, feature.geometry])

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  function commit() {
    const trimmed = value
    if (trimmed !== (feature.properties.name ?? '')) {
      updateFeature(feature.id, {
        properties: { ...feature.properties, name: trimmed },
      })
    }
    onDone()
  }

  const container = map.getCanvasContainer()

  return createPortal(
    <div
      data-elm-theme
      style={{
        position: 'absolute',
        left: screen.x,
        top: screen.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="grid items-center justify-items-center bg-white/95 backdrop-blur-md border border-slate-800 text-slate-800 rounded px-3 py-1.5 text-sm font-medium shadow-lg">
        <div
          className="invisible whitespace-pre pointer-events-none col-start-1 row-start-1 min-w-[12px] px-[2px] leading-tight"
          aria-hidden
        >
          {value + ' '}
        </div>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onDone()
            }
          }}
          onBlur={commit}
          className="col-start-1 row-start-1 bg-transparent outline-none resize-none overflow-hidden whitespace-pre text-center leading-tight min-w-0 min-h-0 px-[2px] w-full h-full m-0 border-none"
          rows={1}
        />
      </div>
    </div>,
    container,
  )
}
