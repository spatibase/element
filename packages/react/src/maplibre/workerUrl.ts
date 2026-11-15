import * as maplibregl from 'maplibre-gl'

/** Where the drop-in loads MapLibre GL JS 6's worker from when the app has not set one. */
export const workerCdnUrl = (version: string) => `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl-worker.mjs`

/**
 * Makes sure MapLibre can start its worker before the drop-in creates its map.
 *
 * MapLibre GL JS 5 inlines its worker. Version 6 is ESM-only and loads the worker from a separate
 * file (`maplibre-gl-worker.mjs`) that it looks for next to its own module (`import.meta.url`).
 * Bundlers (Vite, webpack, Turbopack) move maplibre-gl into their own chunks, so that lookup misses
 * and the map shows nothing unless the app calls `setWorkerUrl` (MapLibre's installation docs).
 * When the app has not, point MapLibre at the jsDelivr copy of the installed version. An app that
 * self-hosts the worker (or must, under a strict CSP) calls `setWorkerUrl` before the editor mounts.
 */
export function ensureWorkerUrl(lib: Pick<typeof maplibregl, 'getVersion' | 'getWorkerUrl' | 'setWorkerUrl'> = maplibregl): void {
  if (typeof lib.getWorkerUrl !== 'function' || typeof lib.setWorkerUrl !== 'function' || typeof lib.getVersion !== 'function') return
  if (lib.getWorkerUrl()) return
  const version = lib.getVersion()
  if (!(parseInt(version, 10) >= 6)) return
  lib.setWorkerUrl(workerCdnUrl(version))
}
