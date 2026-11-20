import { useMemo } from 'react'
import { PencilSimple, CopySimple, Trash, Eye, EyeSlash, StackPlus, Shapes, FolderPlus, FolderMinus, MagnifyingGlassPlus } from '@phosphor-icons/react'
import type { GeoJSONFeature } from '@element-editor/core'
import { getGeometryBBox } from '@element-editor/core'
import { isMultiGeometry, getPartCount } from '@element-editor/core/internal'
import { useDataStore, useUIStore, useGeoStore } from '../../store/StoreContext'
import { useEmit } from '../../contexts/EventContext'
import { useMapController } from '../../contexts/MapControllerContext'
import { ContextMenu } from '../ui/ContextMenu'
import { KbdDark } from '../ui/Kbd'
import { featureLabel } from './FeatureRow'
import { useGeometryGates } from '../../hooks/useGeometryGates'

interface Props {
  x: number
  y: number
  feature: GeoJSONFeature
  onClose: () => void
  /** Group / Ungroup items — layer-list organisation, meaningless in the data table. */
  showGrouping?: boolean
}

/** Right-click menu for a feature row — shared by the layers list and the data table. */
export function FeatureRowContextMenu({ x, y, feature, onClose, showGrouping = true }: Props) {
  const { dataStore, uiStore } = useGeoStore()
  const emit = useEmit()
  const { fitBounds, flyTo } = useMapController()
  const selectedIds = useDataStore((s) => s.selectedIds)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const deleteFeature = useDataStore((s) => s.deleteFeature)
  const duplicateFeature = useDataStore((s) => s.duplicateFeature)
  const toggleFeatureHidden = useDataStore((s) => s.toggleFeatureHidden)
  const openEditDialog = useUIStore((s) => s.openEditDialog)
  // Readonly: only viewing items (zoom, details, show/hide).
  const readonly = useUIStore((s) => s.readonly)

  const { mergeOk, breakOk } = useGeometryGates(selectedIds, feature.geometry)
  const canMerge = selectedIds.length >= 2 && selectedSet.has(feature.id) && mergeOk
  const canBreak = isMultiGeometry(feature.geometry) && breakOk

  // Unlike a row click (which only pans to points), this always zooms —
  // points fly in to street level.
  function zoomTo() {
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates as [number, number]
      flyTo?.([lat, lng], Math.max(dataStore.getState().currentZoom, 16))
    } else {
      fitBounds?.(feature.bbox || getGeometryBBox(feature.geometry))
    }
  }

  // Cmd+G / Cmd+Shift+G semantics: act on the multi-selection if the
  // right-clicked feature is part of one, otherwise just it.
  function selectActing() {
    const ds = dataStore.getState()
    const inMulti = selectedSet.has(feature.id) && selectedIds.length > 1
    if (!inMulti) ds.setSelection([feature.id])
    return ds
  }

  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={readonly ? [
        {
          label: 'Zoom to feature',
          icon: <MagnifyingGlassPlus size={16} />,
          onClick: zoomTo,
        },
        {
          label: 'Details',
          icon: <PencilSimple size={16} />,
          onClick: () => openEditDialog(feature.id),
        },
        {
          label: feature.hidden ? 'Show on map' : 'Hide from map',
          icon: feature.hidden ? <Eye size={16} /> : <EyeSlash size={16} />,
          onClick: () => toggleFeatureHidden(feature.id),
        },
      ] : [
        {
          label: 'Zoom to feature',
          icon: <MagnifyingGlassPlus size={16} />,
          onClick: zoomTo,
        },
        { separator: true as const },
        {
          label: 'Edit',
          icon: <PencilSimple size={16} />,
          shortcut: <><KbdDark>⌘</KbdDark><KbdDark>E</KbdDark></>,
          onClick: () => openEditDialog(feature.id),
        },
        {
          label: 'Duplicate',
          icon: <CopySimple size={16} />,
          shortcut: <><KbdDark>⌘</KbdDark><KbdDark>D</KbdDark></>,
          onClick: () => duplicateFeature(feature.id),
        },
        {
          label: feature.hidden ? 'Show on map' : 'Hide from map',
          icon: feature.hidden ? <Eye size={16} /> : <EyeSlash size={16} />,
          onClick: () => toggleFeatureHidden(feature.id),
        },
        ...(showGrouping ? [
          { separator: true as const },
          feature.groupId
            ? {
                label: 'Ungroup',
                icon: <FolderMinus size={16} />,
                shortcut: <><KbdDark>⌘</KbdDark><KbdDark>⇧</KbdDark><KbdDark>G</KbdDark></>,
                onClick: () => selectActing().ungroupSelection(),
              }
            : {
                label: 'Group',
                icon: <FolderPlus size={16} />,
                shortcut: <><KbdDark>⌘</KbdDark><KbdDark>G</KbdDark></>,
                onClick: () => {
                  const newId = selectActing().groupSelection()
                  if (newId) uiStore.getState().setAutoFocusGroupId(newId)
                },
              },
        ] : []),
        ...(canMerge || canBreak ? [
          { separator: true as const },
          ...(canMerge ? [{
            label: `Merge ${selectedIds.length} features`,
            icon: <StackPlus size={16} />,
            onClick: () => {
              if (dataStore.getState().mergeFeatures()) emit({ type: 'success', message: `Merged ${selectedIds.length} features` })
            },
          }] : []),
          ...(canBreak ? [{
            label: 'Break apart',
            icon: <Shapes size={16} />,
            onClick: () => {
              const count = getPartCount(feature.geometry)
              if (dataStore.getState().breakMultiGeometry(feature.id)) emit({ type: 'feature:broken', featureId: feature.id, count, undo: () => dataStore.getState().undo() })
            },
          }] : []),
        ] : []),
        { separator: true },
        {
          label: 'Delete', icon: <Trash size={16} />,
          onClick: () => {
            deleteFeature(feature.id)
            emit({ type: 'feature:deleted', featureId: feature.id, label: featureLabel(feature), undo: () => dataStore.getState().undo() })
          },
        },
      ]}
    />
  )
}
