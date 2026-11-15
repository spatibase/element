import { describe, it, expect, expectTypeOf } from 'vitest'
import type { ElementEditorControlsProps as MapLibreControlsProps, ElementEditorUIProviderProps as MapLibreUIProps } from '@element-editor/adapter-maplibre'
import type { ElementEditorControlsProps as LeafletControlsProps, ElementEditorUIProviderProps as LeafletUIProps } from '@element-editor/adapter-leaflet'
import { resolveConfig } from '../../../../ui/src/contexts/ElementEditorConfigContext'
import type { ElementEditorProps as MapLibreProps, FeatureStyle, GeoJSONFeature, ElementEditorConfig } from '../../index'
import type { ElementEditorProps as LeafletProps } from '../../leaflet'

describe('featureColor / getFeatureStyle', () => {
  it('resolveConfig passes featureColor through, default undefined', () => {
    expect(resolveConfig().featureColor).toBeUndefined()
    expect(resolveConfig({ featureColor: '' }).featureColor).toBeUndefined()
    expect(resolveConfig({ featureColor: '#00a2f0' }).featureColor).toBe('#00a2f0')
  })

  it('types: one FeatureStyle callback + featureColor fit all four entry points', () => {
    // Type-level: fails `tsc` (and `vitest --typecheck`) if a prop goes missing or its type drifts.
    const style = (f: GeoJSONFeature): FeatureStyle | null => (f.properties?.kind ? { color: '#f00' } : null)
    const maplibre: MapLibreProps = { featureColor: '#00a2f0', getFeatureStyle: style }
    const leaflet: LeafletProps = { featureColor: '#00a2f0', getFeatureStyle: style }
    const config: ElementEditorConfig = { featureColor: '#00a2f0' }
    expectTypeOf(style).toMatchTypeOf<NonNullable<MapLibreControlsProps['getFeatureStyle']>>()
    expectTypeOf(style).toMatchTypeOf<NonNullable<LeafletControlsProps['getFeatureStyle']>>()
    expectTypeOf<MapLibreUIProps['featureColor']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<LeafletUIProps['featureColor']>().toEqualTypeOf<string | undefined>()
    expect([maplibre, leaflet, config].every((p) => p.featureColor === '#00a2f0')).toBe(true)
  })
})
