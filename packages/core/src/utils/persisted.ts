/**
 * Versioned localStorage helper.
 *
 * Writes wrap the value in `{ v, data }`; reads accept that envelope at the
 * current version, silently drop mismatched versions (dev warns), and fall
 * back to the raw legacy shape once for migration. Prevents silent breakage
 * when a persisted shape changes between releases.
 */

import { warnOnce } from './warnOnce'

type Envelope<T> = { v: number; data: T }

/**
 * Per-editor storage scope (`config.persistKey` / `config.persist`; a resolved
 * config satisfies it). `persistKey` namespaces every key (`elm_theme` →
 * `elm_<persistKey>_theme`) so two editors on one origin keep separate state;
 * `persist: false` reads and writes nothing. Omitted = the shared `elm_*` keys.
 */
export interface PersistScope {
  persistKey?: string
  persist?: boolean
}

/** The storage key for `key` under `scope`, or null when persistence is off. */
export function scopedKey(key: string, scope?: PersistScope): string | null {
  if (scope?.persist === false) return null
  const p = scope?.persistKey
  return p ? (key.startsWith('elm_') ? `elm_${p}_${key.slice(4)}` : `${p}_${key}`) : key
}

function isEnvelope(x: unknown): x is Envelope<unknown> {
  return !!x && typeof x === 'object' && 'v' in x && 'data' in x
}

/**
 * Read a persisted value. Returns `null` if missing, corrupt, or from an
 * older version. Optionally validates the inner shape via `parse`, which
 * should return `null` if the data is invalid.
 */
export function readPersisted<T>(
  key: string,
  version: number,
  parse?: (raw: unknown) => T | null,
  scope?: PersistScope,
): T | null {
  const k = scopedKey(key, scope)
  if (typeof window === 'undefined' || k === null) return null
  try {
    const raw = localStorage.getItem(k)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    if (isEnvelope(parsed)) {
      if (parsed.v !== version) {
        warnOnce(`persisted:${k}`, `persisted '${k}' v${parsed.v} !== expected v${version}; dropping`)
        return null
      }
      return parse ? parse(parsed.data) : (parsed.data as T)
    }
    // Legacy unversioned write — accept once; next write will upgrade to envelope.
    return parse ? parse(parsed) : (parsed as T)
  } catch {
    return null
  }
}

/** Write a value wrapped in a versioned envelope. Silently no-ops on failure. */
export function writePersisted<T>(key: string, version: number, value: T, scope?: PersistScope): void {
  const k = scopedKey(key, scope)
  if (typeof window === 'undefined' || k === null) return
  try {
    localStorage.setItem(k, JSON.stringify({ v: version, data: value }))
  } catch {
    // storage full / disabled / quota — intentionally silent
  }
}

/**
 * Raw string read that never throws. Accessing `localStorage` in a sandboxed
 * or storage-blocked iframe throws SecurityError, which during store creation
 * would kill the whole editor.
 */
export function readStorage(key: string, scope?: PersistScope): string | null {
  const k = scopedKey(key, scope)
  if (typeof window === 'undefined' || k === null) return null
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

/** Raw string write that never throws. See `readStorage`. */
export function writeStorage(key: string, value: string, scope?: PersistScope): void {
  const k = scopedKey(key, scope)
  if (typeof window === 'undefined' || k === null) return
  try {
    localStorage.setItem(k, value)
  } catch {
    // storage disabled / quota — intentionally silent
  }
}
