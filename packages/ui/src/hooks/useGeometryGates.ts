import { useDataStore } from '../store/StoreContext'
import type { Geometry } from '@element-editor/core'
import { mergeResultType, breakResultTypes } from '@element-editor/core/internal'

/** What the `geometryTypes` prop lets the menus and toolbars offer (everything when it isn't set). */
export interface GeometryGates {
  /** Whether `type` is an allowed geometry type. */
  allows: (type: string) => boolean
  /** Merging the selected features would give an allowed type (always true for fewer than two). */
  mergeOk: boolean
  /** Breaking `breakGeometry` apart would give only allowed types. */
  breakOk: boolean
  /** Buffer / cut hole can give a result: Polygon or MultiPolygon is allowed. */
  polygonResultOk: boolean
}

/**
 * Gates for actions whose result type is known up front. Subscribes to a stable string per gate and
 * does no work at all while `geometryTypes` is unset.
 */
export function useGeometryGates(selectedIds: readonly string[], breakGeometry?: Geometry): GeometryGates {
  const geometryTypes = useDataStore((s) => s.geometryTypes)
  const mergeType = useDataStore((s) => {
    if (!s.geometryTypes || selectedIds.length < 2) return ''
    const wanted = new Set(selectedIds)
    return mergeResultType(s.features.filter((f) => wanted.has(f.id)).map((f) => f.geometry.type))
  })
  const allows = (type: string) => geometryTypes == null || geometryTypes.includes(type as (typeof geometryTypes)[number])
  const breakOk = !geometryTypes || !breakGeometry || breakResultTypes(breakGeometry).every(allows)
  return {
    allows,
    mergeOk: !mergeType || allows(mergeType),
    breakOk,
    polygonResultOk: allows('Polygon') || allows('MultiPolygon'),
  }
}
