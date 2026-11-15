import type { BuiltinBasemapId } from './style'
import streetsThumb from '../../basemaps/thumbs/streets.webp'
import terrainThumb from '../../basemaps/thumbs/terrain.webp'
import lightThumb from '../../basemaps/thumbs/light.webp'
import darkThumb from '../../basemaps/thumbs/dark.webp'
import osmThumb from '../../basemaps/thumbs/osm.webp'

// Its own module (and chunk): the inlined thumbnails are ~25 KB gzip of base64 that only the
// picker shows, so loading or switching a basemap never pulls them in.
// Thumbnails: Paris at z11 (WebP, inlined by Vite, so the picker makes no thumbnail requests).
export const BASEMAPS: readonly { id: BuiltinBasemapId; label: string; kind: 'vector' | 'raster'; thumbnail: string }[] = [
  { id: 'streets', label: 'Streets', kind: 'vector', thumbnail: streetsThumb },
  { id: 'terrain', label: 'Terrain', kind: 'vector', thumbnail: terrainThumb },
  { id: 'light', label: 'Light', kind: 'vector', thumbnail: lightThumb },
  { id: 'dark', label: 'Dark', kind: 'vector', thumbnail: darkThumb },
  { id: 'osm', label: 'OpenStreetMap', kind: 'raster', thumbnail: osmThumb },
]
