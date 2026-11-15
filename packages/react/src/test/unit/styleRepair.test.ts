/**
 * MapLibre self-repair after `map.setStyle` (adapter-maplibre/src/elementLayers.ts) against a fake
 * map that models what maplibre-gl 5.x does: a full rebuild drops every source / layer / image and
 * fires `style.load`; a style that's still loading throws on `addSource`.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { watchElementLayers, ensureElementLayers, cleanupElementLayers } from '../../../../adapter-maplibre/src/elementLayers'
import { getBasemapIds } from '../../../../adapter-maplibre/src/basemapIds'

type Listener = () => void

class FakeMap {
  sources = new Map<string, object>()
  layers: string[] = []
  images = new Set<string>()
  loaded = true
  glyphs: string | null = 'https://glyphs/{fontstack}/{range}.pbf'
  listeners = new Map<string, Set<Listener>>()
  container = document.createElement('div')

  private checkLoaded() { if (!this.loaded) throw new Error('Style is not done loading.') }
  getContainer() { return this.container }
  getGlyphs() { return this.glyphs }
  getSource(id: string) { return this.sources.get(id) }
  addSource(id: string) {
    this.checkLoaded()
    if (this.sources.has(id)) throw new Error(`There is already a source with ID "${id}".`)
    this.sources.set(id, { id, setData: () => {} })
  }
  removeSource(id: string) { this.sources.delete(id) }
  getLayer(id: string) { return this.layers.includes(id) ? { id } : undefined }
  addLayer(l: { id: string }) {
    this.checkLoaded()
    if (this.layers.includes(l.id)) throw new Error(`Layer "${l.id}" already exists.`)
    this.layers.push(l.id)
  }
  removeLayer(id: string) { this.layers = this.layers.filter((x) => x !== id) }
  setPaintProperty() {}
  hasImage(id: string) { return this.images.has(id) }
  addImage(id: string) { this.images.add(id); this.fire('styledata') } // maplibre fires styledata synchronously
  updateImage() {}
  removeImage(id: string) { this.images.delete(id) }
  getStyle() {
    return { version: 8, sources: Object.fromEntries(this.sources), layers: this.layers.map((id) => ({ id })) }
  }
  on(e: string, f: Listener) { if (!this.listeners.has(e)) this.listeners.set(e, new Set()); this.listeners.get(e)!.add(f) }
  off(e: string, f: Listener) { this.listeners.get(e)?.delete(f) }
  fire(e: string) { for (const f of [...(this.listeners.get(e) ?? [])]) f() }

  /** A host's `setStyle(style, { diff: false })`: everything goes, then the new style loads. */
  replaceStyle(basemapLayers: string[], { async = false } = {}) {
    this.sources = new Map([['host-basemap', {}]])
    this.layers = [...basemapLayers]
    this.images = new Set()
    if (async) { this.loaded = false; return }
    this.fire('styledata')
    this.fire('style.load')
  }
  finishLoading() { this.loaded = true; this.fire('styledata'); this.fire('style.load') }
}

const asMap = (m: FakeMap) => m as unknown as MapLibreMap
const elmLayers = (m: FakeMap) => m.layers.filter((id) => id.startsWith('elm-'))

beforeAll(() => {
  // jsdom has no 2D canvas; the snap diamond only needs getImageData to return something.
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect() {}, save() {}, translate() {}, rotate() {}, fillRect() {}, strokeRect() {}, restore() {},
    getImageData: () => ({ width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) }),
  })) as unknown as HTMLCanvasElement['getContext']
})

describe('ensureElementLayers', () => {
  it('adds every source, layer and the snap image once; a second call adds nothing', () => {
    const m = new FakeMap()
    ensureElementLayers(asMap(m))
    const layers = [...m.layers]
    expect(m.sources.has('elm-features')).toBe(true)
    expect(m.sources.has('elm-drag-ghost')).toBe(true)
    expect(m.sources.has('elm-osm-trace')).toBe(true)
    expect(m.images.has('elm-snap-diamond')).toBe(true)
    expect(layers[0]).toBe('elm-features-fill') // features lowest, overlays above
    expect(layers.indexOf('elm-snap-vertex')).toBeGreaterThan(layers.indexOf('elm-features-text'))
    ensureElementLayers(asMap(m))
    expect(m.layers).toEqual(layers)
    cleanupElementLayers(asMap(m))
    expect(m.layers).toEqual([])
    expect(m.sources.size).toBe(0)
    expect(m.images.size).toBe(0)
  })

  it('a style without glyphs gets every layer but the text one, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = new FakeMap()
    m.glyphs = null
    ensureElementLayers(asMap(m))
    expect(m.getLayer('elm-features-text')).toBeUndefined()
    expect(m.getLayer('elm-features-point')).toBeDefined()
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('glyphs')).length).toBeLessThanOrEqual(1)
    warn.mockRestore()
  })
})

describe('watchElementLayers', () => {
  it('inits once, then restores everything on top of a replaced style, once per replacement', () => {
    const m = new FakeMap()
    m.layers = ['background']
    const synced = vi.fn()
    const stop = watchElementLayers(asMap(m), synced)
    expect(synced).toHaveBeenCalledTimes(1)
    const elm = elmLayers(m)

    // Unrelated style events don't re-sync.
    m.fire('styledata')
    expect(synced).toHaveBeenCalledTimes(1)

    m.replaceStyle(['water', 'roads'])
    expect(synced).toHaveBeenCalledTimes(2)
    expect(m.layers.slice(0, 2)).toEqual(['water', 'roads']) // Element on top
    expect(elmLayers(m)).toEqual(elm)
    expect(m.images.has('elm-snap-diamond')).toBe(true)
    // The replaced style is the basemap now (so a later setBasemap won't carry it over).
    expect([...getBasemapIds(asMap(m))!.layers]).toEqual(['water', 'roads'])

    stop()
    m.replaceStyle(['x'])
    expect(m.sources.has('elm-features')).toBe(false)
  })

  it('a style that is still loading is retried on the next style event (and 5 quick swaps end with one copy)', () => {
    const m = new FakeMap()
    const synced = vi.fn()
    watchElementLayers(asMap(m), synced)
    for (let i = 0; i < 5; i++) m.replaceStyle([`b${i}`], { async: true })
    m.fire('styledata') // still loading: addSource throws, nothing added
    expect(m.sources.has('elm-features')).toBe(false)
    m.finishLoading()
    expect(synced).toHaveBeenCalledTimes(2)
    expect(new Set(elmLayers(m)).size).toBe(elmLayers(m).length)
    expect(m.layers[0]).toBe('b4')
  })

  it('a carried-over but recreated source (setBasemap full rebuild) re-syncs without re-adding layers', () => {
    const m = new FakeMap()
    const synced = vi.fn()
    watchElementLayers(asMap(m), synced)
    const before = [...m.layers]
    const basemap = getBasemapIds(asMap(m))
    m.sources.set('elm-features', { id: 'elm-features', setData: () => {} }) // same id, new object
    m.fire('style.load')
    expect(synced).toHaveBeenCalledTimes(2)
    expect(m.layers).toEqual(before)
    expect(getBasemapIds(asMap(m))).toBe(basemap) // setBasemap recorded it; not overwritten
  })
})
