// @vitest-environment node
// The MapLibre drop-in must import and server-render (to its loading shell) without touching
// window / document / localStorage. prerender waits for every lazy() panel, like a streaming
// framework server render does, so the panels' first render runs on the "server" too.
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import type { FeatureCollection } from 'geojson'
import type { ElementEditorProps } from '../../maplibre/ElementEditor'

const fc: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'a' }, geometry: { type: 'Point', coordinates: [1, 2] } }] }

describe('server render (MapLibre drop-in)', () => {
  it('has no window here', () => {
    expect(typeof window).toBe('undefined')
  })

  it.each([
    ['default', {}],
    ['split layout', { layout: 'split' as const }],
    ['minimal layout', { layout: 'minimal' as const }],
    ['readonly + initialData + onSubmit', { readonly: true, initialData: fc, onSubmit: () => {} }],
  ])('renders %s without throwing', async (_name, props) => {
    const { ElementEditor } = await import('../../maplibre/ElementEditor')
    const errors: unknown[] = []
    const { prelude } = await prerender(createElement(ElementEditor, props as ElementEditorProps), { onError: (e) => { errors.push(e) } })
    const html = await new Response(prelude).text()
    expect(errors).toEqual([])
    expect(html).toContain('data-elm-theme')
  }, 60_000) // the first case imports (transforms) the whole editor
})
