import { useState, useRef, useEffect } from 'react'
import { useNominatim, type NominatimResult } from './useNominatim'
import { useGeoStore } from '../store/StoreContext'
import { useMapController } from '../contexts/MapControllerContext'
import type { GeoJSONFeature, LineStringGeometry, PolygonGeometry } from '@element-editor/core'
import { BOUNDARIES_SCHEMA_ID } from '@element-editor/core/internal'
import { getGeometryBBox } from '@element-editor/core'
import { useIsEventForEditor } from './useKeyboardShortcuts'

export function useSearchState() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { results, loading, error, flush } = useNominatim(query)
  // Enter before the results arrived: go to the first one when they do.
  const goOnResultsRef = useRef(false)
  const { flyTo, fitBounds } = useMapController()
  const { dataStore } = useGeoStore()
  const isForThisEditor = useIsEventForEditor()

  useEffect(() => {
    setOpen(query.trim().length >= 2)
    setActiveIndex(-1)
  }, [query, results])

  // A new query cancels a pending Enter; its results (or failure) settle it.
  useEffect(() => { goOnResultsRef.current = false }, [query])
  useEffect(() => {
    if (!goOnResultsRef.current || loading) return
    goOnResultsRef.current = false
    if (results.length) goTo(0)
  }, [results, loading]) // eslint-disable-line react-hooks/exhaustive-deps -- goTo reads the latest results

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+F is the host page's Find unless the key belongs to this editor.
      if (!isForThisEditor(e)) return
      // Inside the GeoJSON inspector Cmd+F is CodeMirror's own find.
      if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !inCodeEditor(e)) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (e.key === 'Escape' && (open || document.activeElement === inputRef.current)) {
        e.stopPropagation()
        setQuery('')
        setOpen(false)
        setActiveIndex(-1)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [open, isForThisEditor])

  function flyToResult(r: NominatimResult) {
    flyTo?.([parseFloat(r.lat), parseFloat(r.lon)], 15)
  }

  function handleAdd(r: NominatimResult) {
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon)
    const schema = dataStore.getState().getDefaultSchema()
    const properties: Record<string, unknown> = {}
    for (const field of schema.fields) {
      properties[field.key] = field.key === 'name' ? r.display_name.split(',')[0].trim() : ''
    }
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: schema.id,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties,
    }
    dataStore.getState().addFeature(feature)
    flyTo?.([lat, lng], 15)
    clear()
  }

  function handleAddShape(r: NominatimResult) {
    const geojson = r.geojson
    if (!geojson || geojson.type === 'Point') return

    let geometry: LineStringGeometry | PolygonGeometry
    if (geojson.type === 'MultiPolygon') {
      // Take the polygon with the most vertices as the main shape
      const polys = geojson.coordinates as [number, number][][][]
      const largest = polys.reduce((best, cur) => cur[0].length > best[0].length ? cur : best)
      geometry = { type: 'Polygon', coordinates: largest }
    } else {
      geometry = geojson as LineStringGeometry | PolygonGeometry
    }

    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      schemaId: BOUNDARIES_SCHEMA_ID,
      geometry,
      properties: { name: r.display_name.split(',')[0].trim() },
    }
    dataStore.getState().addFeature(feature)
    fitBounds?.(getGeometryBBox(geometry))
    clear()
  }

  function clear() {
    setQuery(''); setOpen(false); setActiveIndex(-1)
  }

  /** Fly to result `i` and highlight it (the dropdown stays, so Tab reaches its Add buttons). */
  function goTo(i: number) {
    setActiveIndex(i)
    flyToResult(results[i])
    // Map's flyTo animation can pull focus to the map container —
    // refocus the search input so Tab still walks the result actions
    // (Add / Shape) via FloatingToolbar's handleSearchKeyDown.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter searches: the highlighted result, else the first one, else (still
    // typing / loading) the first one as soon as the search returns.
    if (e.key === 'Enter') {
      if (query.trim().length < 2) return
      e.preventDefault()
      if (results.length && !loading) { goTo(activeIndex >= 0 ? activeIndex : 0); return }
      goOnResultsRef.current = true
      setOpen(true)
      flush()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    }
  }

  const showDropdown = open && query.trim().length >= 2

  return { query, setQuery, setOpen, showDropdown, containerRef, inputRef, focused, setFocused, results, loading, error, flyToResult, handleAdd, handleAddShape, clear, activeIndex, setActiveIndex, handleInputKeyDown }
}

/** The key was pressed in a CodeMirror editor (the GeoJSON inspector), which has its own Cmd+F. */
export function inCodeEditor(e: KeyboardEvent): boolean {
  return (e.target as Element | null)?.closest?.('.cm-editor') != null
}
