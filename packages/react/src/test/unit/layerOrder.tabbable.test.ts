import { describe, it, expect } from 'vitest'
import type { GeoJSONFeature, Group } from '@element-editor/core'
import { getTabbableFeatureIds } from '../../../../ui/src/utils/layerOrder'

function pt(id: string, groupId?: string): GeoJSONFeature {
  return {
    type: 'Feature',
    id,
    groupId,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  }
}

function grp(id: string, collapsed = false): Group {
  return { id, name: id, collapsed }
}

describe('getTabbableFeatureIds', () => {
  it('returns ids in visual order for ungrouped-only features', () => {
    const ids = getTabbableFeatureIds([pt('a'), pt('b'), pt('c')], [])
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('puts grouped features (in group order) before ungrouped', () => {
    const features = [pt('u1'), pt('g1a', 'g1'), pt('u2'), pt('g2a', 'g2'), pt('g1b', 'g1')]
    const groups = [grp('g1'), grp('g2')]
    expect(getTabbableFeatureIds(features, groups)).toEqual(['g1a', 'g1b', 'g2a', 'u1', 'u2'])
  })

  it('skips features inside collapsed groups', () => {
    const features = [pt('g1a', 'g1'), pt('g2a', 'g2'), pt('u1')]
    const groups = [grp('g1', true), grp('g2')]
    expect(getTabbableFeatureIds(features, groups)).toEqual(['g2a', 'u1'])
  })

  it('returns an empty list when every group is collapsed and no ungrouped features exist', () => {
    const features = [pt('g1a', 'g1'), pt('g2a', 'g2')]
    const groups = [grp('g1', true), grp('g2', true)]
    expect(getTabbableFeatureIds(features, groups)).toEqual([])
  })

  it('preserves array order of features within a group', () => {
    const features = [pt('c', 'g1'), pt('a', 'g1'), pt('b', 'g1')]
    expect(getTabbableFeatureIds(features, [grp('g1')])).toEqual(['c', 'a', 'b'])
  })
})
