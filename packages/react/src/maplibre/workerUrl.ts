import * as maplibregl from 'maplibre-gl'
import type { NetworkConfig } from '@element-editor/core'

/** Default `config.network.maplibreWorker`: jsDelivr copy of the installed maplibre-gl version. */
export const workerCdnUrl = (version: string) => `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl-worker.mjs`

type WorkerApi = Pick<typeof maplibregl, 'getVersion' | 'getWorkerUrl' | 'setWorkerUrl'>

/**
 * The worker URL the drop-in should pass to `setWorkerUrl`, or `null` to leave MapLibre alone:
 * on 5.x (worker built in), when the app already set one (`current`), or with `setting: false`.
 */
export function resolveWorkerUrl(setting: NetworkConfig['maplibreWorker'], version: string, current: string): string | null {
  if (!(parseInt(version, 10) >= 6) || current || setting === false) return null
  return setting ?? workerCdnUrl(version)
}

/**
 * Makes sure MapLibre can start its worker before the drop-in creates its map.
 *
 * MapLibre GL JS 5 inlines its worker. Version 6 is ESM-only and loads the worker from a separate
 * file (`maplibre-gl-worker.mjs`) that it looks for next to its own module (`import.meta.url`).
 * Bundlers (Vite, webpack, Turbopack) move maplibre-gl into their own chunks, so that lookup misses
 * and the map shows nothing unless someone calls `setWorkerUrl`. The drop-in does, with
 * `config.network.maplibreWorker` (see `resolveWorkerUrl`).
 */
export function ensureWorkerUrl(setting: NetworkConfig['maplibreWorker'], lib: WorkerApi = maplibregl): void {
  if (typeof lib.getWorkerUrl !== 'function' || typeof lib.setWorkerUrl !== 'function' || typeof lib.getVersion !== 'function') return
  const url = resolveWorkerUrl(setting, lib.getVersion(), lib.getWorkerUrl())
  if (url) lib.setWorkerUrl(url)
}
