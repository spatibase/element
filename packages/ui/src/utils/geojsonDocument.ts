import { Text, type ChangeSet, type ChangeSpec } from '@codemirror/state'
import type { GeoJSONFeature, Group, Schema } from '@element-editor/core'

/**
 * The GeoJSON inspector's document, built feature by feature so it can be
 * filled in slices and patched per feature. The text is byte-identical to
 * `dataStore.exportGeoJSON()` (= `JSON.stringify(collection, null, 2)`):
 * JSON.stringify indents by depth only, so a feature's text inside the
 * collection is its own pretty JSON shifted right by 4 spaces.
 *
 * Layout (1-based lines):  header (H lines, ends `  "features": [`)
 *                          feature 0 … n-1 (every line but the last feature's
 *                          closing `    }` carries a trailing `,`)
 *                          `  ]`, `}`
 * An empty collection is the header object as one block (`"features": []`).
 */

/** What the editor's document currently holds: one line count per feature, aligned with `features`. */
export interface DocMap {
  features: readonly GeoJSONFeature[]
  counts: number[]
  headerLines: number
  schemas: Schema[]
  groups: Group[]
}

export type LinesOf = (f: GeoJSONFeature) => string[]

/** A feature's lines, indented as they appear inside the collection (no trailing comma). */
export function featureLines(f: GeoJSONFeature): string[] {
  const { _validation, ...clean } = f // exportGeoJSON drops validation state
  void _validation
  const lines = JSON.stringify(clean, null, 2).split('\n')
  for (let i = 0; i < lines.length; i++) lines[i] = '    ' + lines[i]
  return lines
}

/** The header lines; for an empty collection, the whole document. */
export function headerLines(schemas: Schema[], groups: Group[], empty: boolean): string[] {
  const s = JSON.stringify({ type: 'FeatureCollection', metadata: { schemas, groups }, features: [] }, null, 2)
  return (empty ? s : s.slice(0, -3)).split('\n') // drop `]\n}` → ends with `"features": [`
}

const FOOTER = ['  ]', '}']

/** Lines for consecutive features, comma-joined (the last one has no comma). */
function joinedLines(features: readonly GeoJSONFeature[], linesOf: LinesOf, out: string[] = []): string[] {
  for (let i = 0; i < features.length; i++) {
    const ls = linesOf(features[i])
    for (let j = 0; j < ls.length; j++) out.push(ls[j])
    if (i < features.length - 1) out[out.length - 1] += ','
  }
  return out
}

/** Whole document as lines + its map. */
export function buildDoc(features: readonly GeoJSONFeature[], schemas: Schema[], groups: Group[], linesOf: LinesOf): { text: Text; map: DocMap } {
  const head = headerLines(schemas, groups, features.length === 0)
  const map: DocMap = { features, counts: features.map((f) => linesOf(f).length), headerLines: head.length, schemas, groups }
  if (!features.length) return { text: Text.of(head), map }
  const lines = joinedLines(features, linesOf, head)
  lines.push(...FOOTER)
  return { text: Text.of(lines), map }
}

/**
 * buildDoc's lines in pieces — the header, one piece per feature (separator
 * comma included), the footer — so a large document can be serialised and
 * shown slice by slice. Concatenated, the pieces are exactly buildDoc's lines.
 */
export function* docPieces(features: readonly GeoJSONFeature[], schemas: Schema[], groups: Group[], linesOf: LinesOf): Generator<string[]> {
  yield headerLines(schemas, groups, features.length === 0)
  if (!features.length) return
  for (let i = 0; i < features.length; i++) {
    const ls = linesOf(features[i])
    if (i === features.length - 1) { yield ls; break }
    const withComma = ls.slice() // cached lines: never mutate
    withComma[withComma.length - 1] += ','
    yield withComma
  }
  yield FOOTER
}

/** The map for a document that docPieces / buildDoc produced. */
export function docMapOf(features: readonly GeoJSONFeature[], schemas: Schema[], groups: Group[], linesOf: LinesOf): DocMap {
  return { features, counts: features.map((f) => linesOf(f).length), headerLines: headerLines(schemas, groups, features.length === 0).length, schemas, groups }
}

const sameLines = (a: string[], b: string[]) => a === b || (a.length === b.length && a.every((l, i) => l === b[i]))

/** Line number (1-based) of each feature's first line. */
export function featureStartLines(map: DocMap): number[] {
  const out = new Array<number>(map.counts.length)
  let line = map.headerLines + 1
  for (let i = 0; i < map.counts.length; i++) { out[i] = line; line += map.counts[i] }
  return out
}

/** Index of the feature whose lines include `line` (1-based), or -1 (header, separators, footer). */
export function featureIndexAtLine(map: DocMap, line: number): number {
  let start = map.headerLines + 1
  for (let i = 0; i < map.counts.length; i++) {
    if (line < start) return -1
    if (line < start + map.counts[i]) return i
    start += map.counts[i]
  }
  return -1
}

/**
 * Changes that turn `doc` (described by `map`) into the document for the new
 * state, touching only features whose object reference changed, plus the
 * header when schemas/groups changed. Returns null when it must be rebuilt
 * (empty ↔ non-empty).
 */
export function diffDoc(
  doc: Text,
  map: DocMap,
  features: readonly GeoJSONFeature[],
  schemas: Schema[],
  groups: Group[],
  linesOf: LinesOf,
): { changes: ChangeSpec[]; map: DocMap } | null {
  const prev = map.features
  if (!prev.length || !features.length) return null
  const starts = featureStartLines(map)
  const isLast = (i: number) => i === prev.length - 1
  // Feature i's text, excluding the separator comma.
  const fromOf = (i: number) => doc.line(starts[i]).from
  const toOf = (i: number) => doc.line(starts[i] + map.counts[i] - 1).to - (isLast(i) ? 0 : 1)

  const changes: ChangeSpec[] = []
  let headerCount = map.headerLines
  if (schemas !== map.schemas || groups !== map.groups) {
    const head = headerLines(schemas, groups, false)
    changes.push({ from: 0, to: doc.line(map.headerLines).to, insert: Text.of(head) })
    headerCount = head.length
  }

  let p = 0
  const min = Math.min(prev.length, features.length)
  while (p < min && prev[p] === features[p]) p++
  let q = 0
  while (q < min - p && prev[prev.length - 1 - q] === features[features.length - 1 - q]) q++
  const oldEnd = prev.length - q // P[p, oldEnd) → N[p, newEnd)
  const newEnd = features.length - q
  const counts = map.counts.slice(0, p)

  if (oldEnd - p === newEnd - p) {
    for (let i = p; i < oldEnd; i++) {
      // A new object that prints the same (e.g. only `_validation` changed)
      // leaves the text — and a cursor in it — alone. The count stays the
      // map's: text the user typed may be laid out differently from linesOf.
      if (prev[i] === features[i] || sameLines(linesOf(prev[i]), linesOf(features[i]))) { counts.push(map.counts[i]); continue }
      changes.push({ from: fromOf(i), to: toOf(i), insert: Text.of(linesOf(features[i])) })
      counts.push(linesOf(features[i]).length)
    }
  } else {
    const mid = features.slice(p, newEnd)
    for (const f of mid) counts.push(linesOf(f).length)
    if (oldEnd > p && mid.length) {
      changes.push({ from: fromOf(p), to: toOf(oldEnd - 1), insert: Text.of(joinedLines(mid, linesOf)) })
    } else if (oldEnd > p) {
      // Pure removal: take one separator with it.
      if (p > 0) changes.push({ from: toOf(p - 1), to: toOf(oldEnd - 1) })
      else changes.push({ from: fromOf(0), to: fromOf(oldEnd) })
    } else {
      // Pure insertion at index p: `,\n<features>` after p-1, or `<features>,\n` before 0.
      const ls = joinedLines(mid, linesOf)
      if (p > 0) changes.push({ from: toOf(p - 1), insert: Text.of([',', ...ls]) })
      else { ls[ls.length - 1] += ','; ls.push(''); changes.push({ from: fromOf(0), insert: Text.of(ls) }) }
    }
  }
  for (let i = oldEnd; i < prev.length; i++) counts.push(map.counts[i])
  return { changes, map: { features, counts, headerLines: headerCount, schemas, groups } }
}

export type EditResult =
  /** An edit touches the header or the footer: parse the whole document. */
  | { kind: 'full' }
  /**
   * The edited features' text doesn't parse (mid-typing): write nothing, wait
   * for more typing. `from`…`to` is the first failing run's text in the new
   * document (features only, no outer separators), for locating the error.
   */
  | { kind: 'invalid'; from: number; to: number }
  /**
   * The new feature list: edited features re-parsed (deleted ones gone), every
   * other one the same object. `counts` is the updated map's line counts, or
   * null when an edit split one feature into several (the map no longer
   * applies until `canonicalRuns` rewrites the text). `around` lists the new
   * indices next to each edit, for `separatorFixes` to check. `runs` are the
   * re-parsed feature runs: old indices `i`…`j` (inclusive, ascending), now
   * `length` features.
   */
  | { kind: 'ok'; features: unknown[]; counts: number[] | null; around: number[]; runs: EditRun[] }

export interface EditRun { i: number; j: number; length: number }

const GEOMETRY_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']

const isGeometry = (g: unknown): boolean => {
  const o = g as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null
  if (!o || typeof o !== 'object' || !GEOMETRY_TYPES.includes(o.type as string)) return false
  return o.type === 'GeometryCollection' ? Array.isArray(o.geometries) && o.geometries.every(isGeometry) : Array.isArray(o.coordinates)
}

/**
 * Whether parsed text is a feature the store takes — mirrors the guard in
 * core's `updateFeaturesFromEditor`, so half-typed text (geometry lines
 * deleted to retype them) reads as mid-typing instead of being refused.
 */
export function isFeature(f: unknown): boolean {
  return !!f && typeof f === 'object' && (f as { type?: unknown }).type === 'Feature' && isGeometry((f as { geometry?: unknown }).geometry)
}

/** Why parsed text isn't a feature the store takes, in plain words (for a value `isFeature` refuses). */
export function featureIssue(f: unknown): string {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'Expected a feature: { "type": "Feature", … }'
  if ((f as { type?: unknown }).type !== 'Feature') return 'A feature needs "type": "Feature"'
  return 'A feature needs a geometry with a valid "type" and "coordinates"'
}

/**
 * Where `text` stops being JSON as `parseLenient` reads it (the same stray
 * commas forgiven), with the reason in plain words; null when it parses.
 * `JSON.parse` can't tell: its message carries a position in some engines
 * only (Safari gives none), in its own wording.
 */
export function jsonError(text: string): { pos: number; message: string } | null {
  const n = text.length
  let i = 0
  const fail = (message: string, pos = i): never => { throw new JsonFail(pos, message) }
  const ws = () => {
    for (; i < n; i++) { const c = text.charCodeAt(i); if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break }
  }
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const ESCAPES = '"\\/bfnrt'
  const string = () => {
    const start = i++
    for (; ;) {
      if (i >= n) fail('Missing a closing quote', start)
      const c = text.charCodeAt(i)
      if (c === 34) { i++; return }
      if (c === 92) {
        const e = text[i + 1]
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6
        else if (e !== undefined && ESCAPES.includes(e)) i += 2
        else fail('Invalid escape in a string (a backslash must be doubled)')
      } else if (c < 32) fail(c === 10 ? 'Missing a closing quote' : 'Control character in a string', c === 10 ? start : i)
      else i++
    }
  }
  // Members (or elements) with any number of commas around them, at least one between two.
  const container = (close: string, member: () => void) => {
    i++
    for (let count = 0; ; count++) {
      ws()
      let commas = 0
      while (text[i] === ',') { i++; commas++; ws() }
      if (i >= n) fail(`Missing a closing ${close}`)
      if (text[i] === close) { i++; return }
      if (count && !commas) fail(`Expected a comma or a closing ${close}`)
      member()
    }
  }
  const value = (): void => {
    ws()
    const c = text[i]
    if (c === undefined) fail('Expected a value, the text ends here')
    else if (c === '{') {
      container('}', () => {
        if (text[i] !== '"') fail('Expected a property name in double quotes')
        string()
        ws()
        if (text[i] !== ':') fail('Expected a colon after the property name')
        i++
        value()
      })
    } else if (c === '[') container(']', value)
    else if (c === '"') string()
    else if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(text)
      if (!m) fail('Invalid number')
      i += m![0].length
    } else {
      const word = ['true', 'false', 'null'].find((w) => text.startsWith(w, i))
      if (!word) fail('Expected a value (text needs double quotes)')
      i += word!.length
    }
  }
  try {
    if (!text.trim()) return null
    value()
    ws()
    while (text[i] === ',') { i++; ws() }
    if (i < n) fail('Unexpected text after the end')
    return null
  } catch (e) {
    if (e instanceof JsonFail) return { pos: e.pos, message: e.message }
    return null // nested too deep to scan (RangeError)
  }
}

class JsonFail {
  constructor(readonly pos: number, readonly message: string) {}
}

/**
 * Re-parses only the features the user's edits touched. `base` is the
 * document `map` describes, `changes` the user's edits since (base → `doc`).
 * An edit inside one feature re-parses that feature; one spanning several
 * (deleting whole features, or the separator between two) re-parses the run
 * from the first to the last, as `[text]` read leniently — empty when they
 * were all deleted. Commas left over between features are `separatorFixes`'
 * business.
 */
export function parseEdits(base: Text, map: DocMap, changes: ChangeSet, doc: Text): EditResult {
  const n = map.features.length
  if (!n) return { kind: 'full' }
  const starts = featureStartLines(map)
  const fromOf = (i: number) => base.line(starts[i]).from
  const endOf = (i: number) => base.line(starts[i] + map.counts[i] - 1).to // incl. the separator comma
  const toOf = (i: number) => endOf(i) - (i === n - 1 ? 0 : 1)
  // Last feature starting at or before `pos`.
  const atOrBefore = (pos: number) => {
    const line = base.lineAt(pos).number
    let lo = 0
    let hi = n - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= line) lo = mid; else hi = mid - 1 }
    return lo
  }
  const runs: [number, number][] = [] // touched feature runs, inclusive, ascending
  let outside = false
  changes.iterChangedRanges((fromA, toA) => {
    if (outside) return
    if (fromA < fromOf(0) || toA > endOf(n - 1)) { outside = true; return }
    let i = atOrBefore(fromA)
    let j = Math.max(i, atOrBefore(toA))
    if (fromA > toOf(i)) { // starts in the separator after feature i
      if (j === i) j = i + 1 // only the separator: both neighbours
      else i++
    }
    if (toA > toOf(j) && j < n - 1) j++ // reaches the separator after j: the next one too
    const last = runs[runs.length - 1]
    if (last && i <= last[1]) last[1] = Math.max(last[1], j)
    else runs.push([i, j])
  })
  if (outside || !runs.length) return { kind: 'full' }

  const features: unknown[] = map.features.slice()
  const counts = map.counts.slice()
  const lengths: number[] = []
  let split = false
  let bad: { from: number; to: number } | null = null // the first (lowest) run that doesn't parse
  for (let r = runs.length - 1; r >= 0; r--) { // back to front: splices don't shift what's left
    const [i, j] = runs[r]
    const from = changes.mapPos(fromOf(i), -1)
    const to = changes.mapPos(toOf(j), 1)
    const list = parseLenient('[' + doc.sliceString(from, to) + ']')
    if (!Array.isArray(list) || !list.every(isFeature)) { bad = { from, to }; continue }
    if (bad) continue // invalid anyway: only looking for an earlier failing run
    features.splice(i, j - i + 1, ...list)
    if (list.length === 1) counts.splice(i, j - i + 1, doc.lineAt(to).number - doc.lineAt(from).number + 1)
    else if (!list.length) counts.splice(i, j - i + 1)
    else split = true
    lengths[r] = list.length
  }
  if (bad) return { kind: 'invalid', ...bad }
  const around: number[] = []
  let shift = 0
  runs.forEach(([i, j], r) => {
    const at = i + shift
    for (let k = at - 1; k <= at + lengths[r]; k++) around.push(k)
    shift += lengths[r] - (j - i + 1)
  })
  return { kind: 'ok', features, counts: split ? null : counts, around, runs: runs.map(([i, j], r) => ({ i, j, length: lengths[r] })) }
}

/** The smallest single change turning `a` into `b` (common prefix and suffix kept), offset by `at`; null when equal. */
export function smallestChange(a: string, b: string, at = 0): { from: number; to: number; insert: string } | null {
  if (a === b) return null
  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++
  return { from: at + p, to: at + a.length - s, insert: b.slice(p, b.length - s) }
}

/**
 * Rewrites the runs `parseEdits` re-parsed as buildDoc prints them, so the
 * per-feature map applies again whatever the user's text looked like (one
 * feature split into several, a pasted feature on one line, …). `features` is
 * the committed list, aligned with the parse (the store may have added ids or
 * empty properties). Each run's region runs from the end of the feature before
 * it (or the header) to the start of the one after it (or the footer), so the
 * separators are rewritten too; adjacent runs share one region. The changes
 * apply to `doc` (= `changes` applied to `base`) and are each the smallest
 * replacement, so text already in shape — say a feature copied from the
 * inspector — is left alone. Returns them with the map's new line counts.
 */
export function canonicalRuns(
  base: Text,
  map: DocMap,
  changes: ChangeSet,
  doc: Text,
  runs: readonly EditRun[],
  features: readonly GeoJSONFeature[],
  linesOf: LinesOf,
): { changes: ChangeSpec[]; counts: number[] } {
  const n = map.features.length
  const starts = featureStartLines(map)
  const fromOf = (i: number) => base.line(starts[i]).from
  const endOf = (i: number) => base.line(starts[i] + map.counts[i] - 1).to // incl. the separator comma
  const merged: (EditRun & { at: number })[] = []
  let shift = 0
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r.i === last.j + 1) { last.j = r.j; last.length += r.length }
    else merged.push({ ...r, at: r.i + shift })
    shift += r.length - (r.j - r.i + 1)
  }
  const out: ChangeSpec[] = []
  const counts: number[] = []
  let next = 0 // first old index whose count isn't copied yet
  for (const { i, j, at, length } of merged) {
    for (; next < i; next++) counts.push(map.counts[next])
    next = j + 1
    const fs = features.slice(at, at + length)
    for (const f of fs) counts.push(linesOf(f).length)
    const hasPrev = i > 0
    const hasNext = j < n - 1
    // Region boundaries in `base` no edit reaches into (parseEdits widens a run over any separator an edit touches).
    const from = changes.mapPos(hasPrev ? endOf(i - 1) - 1 : fromOf(0) - 1, -1)
    const to = changes.mapPos(hasNext ? fromOf(j + 1) : endOf(n - 1) + 1, 1)
    const text = length
      ? (hasPrev ? ',' : '') + '\n' + joinedLines(fs, linesOf).join('\n') + (hasNext ? ',' : '') + '\n'
      : (hasPrev && hasNext ? ',' : '') + '\n'
    const c = smallestChange(doc.sliceString(from, to), text, from)
    if (c) out.push(c)
  }
  for (; next < n; next++) counts.push(map.counts[next])
  return { changes: out, counts }
}

/**
 * Checks that the features at `around` sit in `doc` exactly where `counts`
 * says, in buildDoc's shape (`    {` … `    },`, the last one `    }` before
 * `  ]`). Returns the edits that restore it — only ever dropping the comma a
 * deleted last feature leaves on the new last one — or null when the text is
 * otherwise off (the caller then parses the whole document).
 */
export function separatorFixes(doc: Text, headerLines: number, counts: readonly number[], around: Iterable<number>): ChangeSpec[] | null {
  const n = counts.length
  if (!n) return null
  const starts = featureStartLines({ headerLines, counts } as DocMap)
  const fixes: ChangeSpec[] = []
  for (const k of around) {
    if (k < 0 || k >= n) continue
    const s = starts[k]
    const e = s + counts[k] - 1
    if (e + 1 > doc.lines || doc.line(s).text !== '    {') return null
    const end = doc.line(e)
    if (k < n - 1) { if (end.text !== '    },') return null; continue }
    if (doc.line(e + 1).text !== '  ]') return null
    // `,\n` → `\n` rather than just the comma: the change then touches a
    // whole-line deletion at the next line's start, so the editor's history
    // joins it to that deletion and one undo restores the text exactly
    // (undoing the comma alone would re-add it, and the next commit drop it again).
    if (end.text === '    },') fixes.push({ from: end.to - 1, to: end.to + 1, insert: '\n' })
    else if (end.text !== '    }') return null
  }
  return fixes
}

/** Whether two change sets over the same document touch overlapping (or adjacent) ranges. */
export function changesOverlap(a: ChangeSet, b: ChangeSet): boolean {
  const ranges: [number, number][] = []
  a.iterChangedRanges((from, to) => { ranges.push([from, to]) })
  let hit = false
  b.iterChangedRanges((from, to) => { if (!hit) hit = ranges.some(([f, t]) => f <= to && from <= t) })
  return hit
}

/**
 * Feature line ranges found by scanning the document, for when the user has
 * typed into it and the map no longer applies. A feature starts at a line that
 * is exactly `    {`; stops once feature `index` is found. Counting starts
 * at `fromLine`.
 */
export function scanFeatureRange(doc: Text, index: number, fromLine = 1): { start: number; end: number } | null {
  // A feature runs to the line before the next `    {`; the last one ends at
  // its first `    }` / `    },`.
  let n = 0
  let line = fromLine
  let start = -1
  let close = -1
  for (const iter = doc.iterLines(fromLine); !iter.next().done; line++) {
    const v = iter.value
    if (v === '    {') {
      if (start !== -1) return { start, end: line - 1 }
      if (n++ === index) start = line
    } else if (start !== -1 && close === -1 && (v === '    }' || v === '    },')) close = line
  }
  if (start === -1) return null
  return { start, end: close === -1 ? start : close }
}

/**
 * Parses the inspector's text, forgiving what deleting whole lines leaves
 * behind: an empty document (an empty collection) and stray commas — trailing
 * (`},\n  ]`), leading (`[,`) or doubled (`},,{`). Commas inside strings are
 * left alone. Null when it still isn't JSON.
 */
export function parseLenient(text: string): unknown {
  if (!text.trim()) return { type: 'FeatureCollection', features: [] }
  try { return JSON.parse(text) } catch { /* try without stray commas */ }
  const out: string[] = []
  let from = 0
  let inString = false
  let prev = '' // last significant character outside strings
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; prev = c; continue }
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue
    if (c === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      const next = text[j]
      if (prev === '[' || prev === '{' || prev === ',' || next === ']' || next === '}' || next === ',' || next === undefined) {
        out.push(text.slice(from, i))
        from = i + 1
        continue
      }
    }
    prev = c
  }
  out.push(text.slice(from))
  try { return JSON.parse(out.join('')) } catch { return null }
}
