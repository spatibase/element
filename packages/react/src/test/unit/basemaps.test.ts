import { describe, it, expect, vi } from 'vitest'
import { BASEMAPS, resolveBasemap, loadBasemapStyle, DEFAULT_SPRITE_URL } from '../../../../adapter-maplibre/src/basemaps'
import { carryOverElm } from '../../../../adapter-maplibre/src/basemaps/style'

describe('basemaps', () => {
  it('every built-in has a thumbnail', () => {
    for (const b of BASEMAPS) expect(b.thumbnail, b.id).toBeTruthy()
  })
  it('auto follows the theme; others pass through', () => {
    expect(resolveBasemap('auto', 'light')).toBe('streets')
    expect(resolveBasemap('auto', 'dark')).toBe('dark')
    expect(resolveBasemap('terrain', 'dark')).toBe('terrain')
  })
  it('osm is an inline raster style without {s}', async () => {
    const s: any = await loadBasemapStyle('osm')
    expect(s.sources.basemap.tiles[0]).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(s.sources.basemap.tiles[0]).not.toContain('{s}')
    expect(s.sources.basemap.maxzoom).toBe(19)
    expect(s.sources.basemap.attribution).toContain('OpenStreetMap')
  })
  it('custom inputs: url -> raster, style url passes through, object is cloned', async () => {
    const r: any = await loadBasemapStyle({ url: 'https://x/{z}/{x}/{y}.png', attribution: 'X', maxZoom: 5 })
    expect(r.sources.basemap.maxzoom).toBe(5)
    expect(await loadBasemapStyle({ style: 'https://x/style.json' })).toBe('https://x/style.json')
    const obj = { version: 8, sources: {}, layers: [] } as any
    expect(await loadBasemapStyle({ style: obj })).not.toBe(obj)
  })
  it('built-in vector style has glyphs, sprite and Noto fonts (no Inter)', async () => {
    const s: any = await loadBasemapStyle('streets')
    expect(s.glyphs).toContain('openfreemap')
    expect(s.sprite).toBe(DEFAULT_SPRITE_URL)
    expect((await loadBasemapStyle('dark', { network: { sprite: 'https://a/b' } }) as any).sprite).toBe('https://a/b')
    expect(JSON.stringify(s.layers)).not.toContain('"Inter ')
    expect(JSON.stringify(s.layers)).toContain('Noto Sans')
  })
  describe('config.network', () => {
    it('defaults: OpenFreeMap tiles + credit, Mapterhorn terrarium DEM', async () => {
      const s: any = await loadBasemapStyle('streets')
      expect(s.sources.openmaptiles).toMatchObject({ url: 'https://tiles.openfreemap.org/planet' })
      expect(s.sources.openmaptiles.attribution).toContain('OpenFreeMap')
      expect(s.sources['terrain-dem']).toMatchObject({ tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], encoding: 'terrarium' })
    })
    it('rewrites vector tiles, DEM (with encoding), glyphs and sprite', async () => {
      const s: any = await loadBasemapStyle('terrain', { network: {
        vectorTiles: { url: 'https://v.example/tiles.json?key=k', attribution: '© V' },
        dem: { tiles: ['https://d.example/{z}/{x}/{y}.png'], encoding: 'mapbox', attribution: '© D' },
        glyphs: 'https://g.example/{fontstack}/{range}.pbf',
        sprite: 'https://s.example/sprite',
      } })
      expect(s.sources.openmaptiles).toEqual({ type: 'vector', url: 'https://v.example/tiles.json?key=k', attribution: '© V' })
      expect(s.sources['terrain-dem']).toMatchObject({ tiles: ['https://d.example/{z}/{x}/{y}.png'], encoding: 'mapbox', attribution: '© D', tileSize: 512 })
      expect(s.sources['terrain-dem'].url).toBeUndefined()
      expect(s.glyphs).toBe('https://g.example/{fontstack}/{range}.pbf')
      expect(s.sprite).toBe('https://s.example/sprite')
    })
    it('a new host without attribution (runs first: the warning is once per page) drops the old provider credit (OSM data credit stays) and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const s: any = await loadBasemapStyle('streets', { network: { vectorTiles: 'https://v.example/planet', dem: 'https://d.example/{z}/{x}/{y}.webp' } })
      expect(s.sources.openmaptiles.attribution).toContain('OpenStreetMap')
      expect(s.sources.openmaptiles.attribution).not.toContain('OpenFreeMap')
      expect(s.sources['terrain-dem'].attribution).toBeUndefined()
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/network\.vectorTiles[\s\S]*network\.dem/)
      warn.mockRestore()
    })
    it('a string: {z} template -> tiles, else TileJSON url (the other one dropped)', async () => {
      const s: any = await loadBasemapStyle('streets', { network: { vectorTiles: 'https://v.example/{z}/{x}/{y}.pbf', dem: 'https://d.example/tiles.json' } })
      expect(s.sources.openmaptiles.tiles).toEqual(['https://v.example/{z}/{x}/{y}.pbf'])
      expect(s.sources.openmaptiles.url).toBeUndefined()
      expect(s.sources['terrain-dem'].url).toBe('https://d.example/tiles.json')
      expect(s.sources['terrain-dem'].tiles).toBeUndefined()
    })
    it('an object without a new host (just encoding) keeps the default credit', async () => {
      const s: any = await loadBasemapStyle('streets', { network: { dem: { encoding: 'mapbox' } } })
      expect(s.sources['terrain-dem']).toMatchObject({ encoding: 'mapbox', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'] })
      expect(s.sources['terrain-dem'].attribution).toContain('Mapterhorn')
    })
    it("osmRaster rewrites the 'osm' raster basemap", async () => {
      const s: any = await loadBasemapStyle('osm', { network: { osmRaster: { tiles: ['https://r.example/{z}/{x}/{y}.png'], attribution: '© R', maxzoom: 17 } } })
      expect(s.sources.basemap).toMatchObject({ type: 'raster', tiles: ['https://r.example/{z}/{x}/{y}.png'], attribution: '© R', maxzoom: 17 })
    })
    it('two configs in a row do not leak into each other (the cache holds the raw JSON)', async () => {
      await loadBasemapStyle('light', { network: { vectorTiles: { url: 'https://a.example/planet', attribution: 'A' } } })
      const s: any = await loadBasemapStyle('light')
      expect(s.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet')
    })
  })
  it('transformStyle keeps elm-* sources/layers and drops others', () => {
    const prev: any = {
      version: 8,
      sources: { old: { type: 'geojson' }, 'elm-features': { type: 'geojson' } },
      layers: [
        { id: 'old-l', type: 'fill', source: 'old' },
        { id: 'elm-features-fill', type: 'fill', source: 'elm-features' },
        { id: 'elm-x', type: 'line', source: 'old' },
        { id: 'other-on-elm', type: 'line', source: 'elm-features' },
      ],
    }
    const next: any = { version: 8, sources: { n: { type: 'geojson' } }, layers: [{ id: 'n-l', type: 'fill', source: 'n' }] }
    const out: any = carryOverElm(prev, next)
    expect(Object.keys(out.sources)).toEqual(['n', 'elm-features'])
    expect(out.layers.map((l: any) => l.id)).toEqual(['n-l', 'elm-features-fill', 'elm-x', 'other-on-elm'])
  })
  it('with the previous basemap known, host layers and sources are carried too, in order', () => {
    const prev: any = {
      version: 8,
      sources: { old: { type: 'vector' }, mine: { type: 'geojson' }, 'elm-features': { type: 'geojson' }, shared: { type: 'geojson' } },
      layers: [
        { id: 'old-bg', type: 'background' },
        { id: 'old-roads', type: 'line', source: 'old' },
        { id: 'my-fill', type: 'fill', source: 'mine' },
        { id: 'elm-features-fill', type: 'fill', source: 'elm-features' },
        { id: 'my-bg', type: 'background' },
        { id: 'elm-features-line', type: 'line', source: 'elm-features' },
        { id: 'my-label', type: 'symbol', source: 'mine' },
        { id: 'my-clash', type: 'line', source: 'shared' },
        { id: 'n-l', type: 'fill', source: 'mine' },
      ],
    }
    const basemap = { layers: new Set(['old-bg', 'old-roads']), sources: new Set(['old']) }
    const next: any = { version: 8, sources: { n: { type: 'vector' }, shared: { type: 'vector' } }, layers: [{ id: 'n-l', type: 'fill', source: 'n' }] }
    const out: any = carryOverElm(prev, next, basemap)
    expect(Object.keys(out.sources)).toEqual(['n', 'shared', 'mine', 'elm-features'])
    expect(out.sources.shared.type).toBe('vector') // the new basemap's source wins a clash
    // Old basemap gone; host layers keep their order around Element's; a layer whose id or
    // source clashes with the new basemap is dropped.
    expect(out.layers.map((l: any) => l.id)).toEqual(['n-l', 'my-fill', 'elm-features-fill', 'my-bg', 'elm-features-line', 'my-label'])
  })
})

