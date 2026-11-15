import { useDataStore, useUIStore, useGeoStore } from '../store/StoreContext'
import { getFixedShortcutDisplay } from '@element-editor/core'
import { getPartCount, canProcessShape } from '@element-editor/core/internal'
import type { GeoJSONFeature, ShortcutId } from '@element-editor/core'
import { useEmit } from '../contexts/EventContext'
import { useShortcutConfig } from '../contexts/ShortcutConfigContext'
import { Trash, Resize, Scissors, Knife, Shapes, StackPlus, WaveSine, SquareLogo, Crosshair, DotOutline } from '@phosphor-icons/react'
import { centroid } from '@turf/centroid'
import { ContextMenu, type ContextMenuItem } from './ui/ContextMenu'
import { KbdDark } from './ui/Kbd'

export interface FeatureContextMenuData {
  feature: GeoJSONFeature
  /** POI-only: trigger the inline "Precise coordinates" popup on the marker. */
  requestPreciseCoords?: () => void
}

interface Props {
  x: number
  y: number
  data: FeatureContextMenuData
  onClose: () => void
}

const SimplifyIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2.5,8 5.25,3.5 8,8 10.75,12.5 13.5,8" />
  </svg>
)

type EditingModeOption = 'cut-hole' | 'slice-shape' | 'simplify-shape' | 'smooth-shape' | 'buffer-shape'

interface ModeEntry {
  mode: EditingModeOption
  label: string
  icon: React.ReactNode
  shortcut?: ShortcutId
}

const POLYGON_MODE_ENTRIES: ModeEntry[] = [
  { mode: 'cut-hole',        label: 'Cut hole',        icon: <Scissors size={16} />,    shortcut: 'cut-hole' },
  { mode: 'slice-shape',     label: 'Slice shape',     icon: <Knife size={16} />,       shortcut: 'slice-shape' },
]

/** Polygons and lines (`canProcessShape`). */
const SHAPE_MODE_ENTRIES: ModeEntry[] = [
  { mode: 'simplify-shape',  label: 'Simplify shape',  icon: SimplifyIcon },
  { mode: 'smooth-shape',    label: 'Smooth shape',    icon: <WaveSine size={16} /> },
  { mode: 'buffer-shape',    label: 'Buffer',          icon: <SquareLogo size={16} /> },
]

/**
 * Right-click menu for features on the map. Mirrors the selection toolbar
 * (minus Duplicate) so users can reach the same editing actions without
 * moving the cursor away from the feature.
 *
 * Selection invariant: the adapter selects the clicked feature before
 * opening the menu (unless it's already part of a 2+ multi-selection), so
 * handlers here read the current selection and don't re-select.
 */
export function FeatureMapContextMenu({ x, y, data, onClose }: Props) {
  const { feature, requestPreciseCoords } = data
  const { dataStore } = useGeoStore()
  const readonly = useUIStore((s) => s.readonly)
  const transformActive = useUIStore((s) => s.transformActive)
  const setTransformActive = useUIStore((s) => s.setTransformActive)
  const editingMode = useUIStore((s) => s.editingMode)
  const setEditingMode = useUIStore((s) => s.setEditingMode)
  const closeDialog = useUIStore((s) => s.closeDialog)
  const selectedIds = useDataStore((s) => s.selectedIds)
  const emit = useEmit()
  const { getKey } = useShortcutConfig()

  if (readonly) return null

  const geomType = feature.geometry.type
  const isPolygon = geomType === 'Polygon' || geomType === 'MultiPolygon'
  const isMulti = geomType === 'MultiPoint' || geomType === 'MultiPolygon' || geomType === 'MultiLineString' || geomType === 'GeometryCollection'
  // Merge uses the current selection. Only offer it if the clicked feature is
  // part of a multi-selection of 2+ — merging unrelated features would surprise.
  const inMultiSelection = selectedIds.length >= 2 && selectedIds.includes(feature.id)

  function toggleEditingMode(mode: EditingModeOption) {
    setEditingMode(editingMode === mode ? 'none' : mode)
    if (transformActive) setTransformActive(false)
  }

  function kbd(id: ShortcutId) {
    return <KbdDark>{getKey(id).toUpperCase()}</KbdDark>
  }

  const items: ContextMenuItem[] = []

  items.push({
    label: 'Transform',
    icon: <Resize size={16} />,
    shortcut: kbd('toggle-transform'),
    onClick: () => {
      setTransformActive(!transformActive)
      if (!transformActive && editingMode !== 'none') setEditingMode('none')
    },
  })

  if (canProcessShape(geomType)) {
    items.push({ separator: true })
    for (const entry of [...(isPolygon ? POLYGON_MODE_ENTRIES : []), ...SHAPE_MODE_ENTRIES]) {
      items.push({
        label: entry.label,
        icon: entry.icon,
        shortcut: entry.shortcut ? kbd(entry.shortcut) : undefined,
        onClick: () => toggleEditingMode(entry.mode),
      })
    }
  }

  if (isPolygon) {
    items.push({
      label: 'Center point',
      icon: <DotOutline size={16} weight="fill" />,
      onClick: () => {
        // Centroid is the average of all polygon vertices — a sensible
        // "middle" for most shapes. For pathological concave polygons the
        // user can still drag the resulting point afterwards.
        const c = centroid(feature as GeoJSON.Feature)
        const sourceName = (typeof feature.properties?.name === 'string' && feature.properties.name)
          ? feature.properties.name
          : null
        const point: GeoJSONFeature = {
          type: 'Feature',
          id: crypto.randomUUID(),
          geometry: { type: 'Point', coordinates: c.geometry.coordinates as [number, number] },
          properties: sourceName ? { name: `${sourceName} center` } : {},
          groupId: feature.groupId,
        }
        dataStore.getState().addFeature(point)
      },
    })
  }

  if (isMulti || inMultiSelection) {
    items.push({ separator: true })
    if (isMulti) {
      items.push({
        label: 'Break apart',
        icon: <Shapes size={16} />,
        shortcut: kbd('break-apart'),
        onClick: () => {
          const count = getPartCount(feature.geometry)
          if (dataStore.getState().breakMultiGeometry(feature.id)) emit({ type: 'feature:broken', featureId: feature.id, count, undo: () => dataStore.getState().undo() })
        },
      })
    }
    if (inMultiSelection) {
      items.push({
        label: `Merge ${selectedIds.length} features`,
        icon: <StackPlus size={16} />,
        onClick: () => {
          const n = selectedIds.length
          dataStore.getState().mergeFeatures()
          emit({ type: 'success', message: `Merged ${n} features` })
        },
      })
    }
  }

  if (requestPreciseCoords) {
    items.push({ separator: true })
    items.push({
      label: 'Precise coordinates…',
      icon: <Crosshair size={16} />,
      onClick: requestPreciseCoords,
    })
  }

  items.push({ separator: true })
  items.push({
    label: inMultiSelection ? `Delete ${selectedIds.length} features` : 'Delete',
    icon: <Trash size={16} />,
    shortcut: <KbdDark>{getFixedShortcutDisplay('delete-selected')}</KbdDark>,
    onClick: () => {
      const count = inMultiSelection ? selectedIds.length : 1
      const label = String(feature.properties?.name || 'feature')
      dataStore.getState().deleteSelection()
      closeDialog()
      if (count === 1) {
        emit({ type: 'feature:deleted', featureId: feature.id, label, undo: () => dataStore.getState().undo() })
      } else {
        emit({ type: 'features:deleted', count, undo: () => dataStore.getState().undo() })
      }
    },
  })

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
