import { describe, it, expect } from 'vitest'
import { ChangeSet, Text } from '../../../../ui/node_modules/@codemirror/state' // not a react dep
import type { GeoJSONFeature, Group, Schema } from '../../../../core/src/types/geojson'
import { buildDoc, canonicalRuns, smallestChange, changesOverlap, diffDoc, docMapOf, docPieces, featureLines, featureIndexAtLine, featureIssue, featureStartLines, isFeature, jsonError, parseEdits, parseLenient, scanFeatureRange, separatorFixes } from '../../../../ui/src/utils/geojsonDocument'

const exportText = (features: GeoJSONFeature[], schemas: Schema[], groups: Group[]) =>
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: { schemas, groups },
    features: features.map((f) => { const c = { ...f }; delete c._validation; return c }),
  }, null, 2)

const pt = (id: string, x = 1): GeoJSONFeature => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, 2] }, properties: { name: id, tags: [], nested: {} } })
const poly = (id: string): GeoJSONFeature => ({
  type: 'Feature', id, schemaId: 's1',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  properties: { note: 'a "quoted"\nline' },
  _validation: { errors: ['x'], warnings: [] },
})

const schemas: Schema[] = [{ id: 's1', name: 'Default', fields: [] } as unknown as Schema]
const groups: Group[] = []
const cache = new Map<GeoJSONFeature, string[]>()
const linesOf = (f: GeoJSONFeature) => { let l = cache.get(f); if (!l) { l = featureLines(f); cache.set(f, l) } return l }

function check(prev: GeoJSONFeature[], next: GeoJSONFeature[], nextSchemas = schemas) {
  const { text, map } = buildDoc(prev, schemas, groups, linesOf)
  expect(text.toString()).toBe(exportText(prev, schemas, groups))
  const res = diffDoc(text, map, next, nextSchemas, groups, linesOf)
  expect(res).not.toBeNull()
  const after = ChangeSet.of(res!.changes, text.length).apply(text)
  expect(after.toString()).toBe(exportText(next, nextSchemas, groups))
  // The new map matches a fresh build.
  expect(res!.map.counts).toEqual(buildDoc(next, nextSchemas, groups, linesOf).map.counts)
  expect(res!.map.headerLines).toBe(buildDoc(next, nextSchemas, groups, linesOf).map.headerLines)
  return res!
}

describe('GeoJSON inspector document', () => {
  const base = [pt('a'), poly('b'), pt('c'), poly('d'), pt('e')]

  it('builds exactly what exportGeoJSON prints', () => {
    expect(buildDoc([], schemas, groups, linesOf).text.toString()).toBe(exportText([], schemas, groups))
    expect(buildDoc(base, schemas, groups, linesOf).text.toString()).toBe(exportText(base, schemas, groups))
  })

  it('patches changed features in place', () => {
    const next = [...base]; next[1] = { ...poly('b'), properties: { note: 'changed' } }; next[4] = pt('e', 9)
    const res = check(base, next)
    expect(res.changes).toHaveLength(2)
    check(base, base.map((f, i) => (i === 0 ? pt('a', 5) : f)))
  })

  it('inserts at start, middle and end', () => {
    check(base, [pt('n1'), pt('n2'), ...base])
    check(base, [...base.slice(0, 2), poly('n'), ...base.slice(2)])
    check(base, [...base, pt('n')])
  })

  it('removes at start, middle and end', () => {
    check(base, base.slice(2))
    check(base, [base[0], base[3], base[4]])
    check(base, base.slice(0, 3))
    check(base, [base[2]])
  })

  it('replaces a middle span and updates the header', () => {
    check(base, [base[0], pt('x'), base[4]])
    check(base, base, [...schemas, { id: 's2', name: 'Two', fields: [] } as unknown as Schema])
  })

  it('asks for a rebuild across empty', () => {
    const { text, map } = buildDoc(base, schemas, groups, linesOf)
    expect(diffDoc(text, map, [], schemas, groups, linesOf)).toBeNull()
  })

  it('maps feature lines and scans an edited document the same way', () => {
    const { text, map } = buildDoc(base, schemas, groups, linesOf)
    const starts = featureStartLines(map)
    base.forEach((_, i) => {
      expect(text.line(starts[i]).text).toBe('    {')
      expect(scanFeatureRange(text, i)).toEqual({ start: starts[i], end: starts[i] + map.counts[i] - 1 })
    })
    expect(scanFeatureRange(Text.of(['{}']), 0)).toBeNull()
  })
})

describe('GeoJSON inspector edits', () => {
  const base = [pt('a'), poly('b'), pt('c'), poly('d'), pt('e')]
  const built = () => buildDoc(base, schemas, groups, linesOf)
  /** Replaces the first `find` at or after feature `i`'s first line with `insert`. */
  const edit = (text: Text, map: ReturnType<typeof built>['map'], i: number, find: string, insert: string) => {
    const from = text.toString().indexOf(find, text.line(featureStartLines(map)[i]).from)
    return ChangeSet.of({ from, to: from + find.length, insert }, text.length)
  }

  it('builds the same document in pieces', () => {
    for (const fs of [[], base]) {
      const lines = [...docPieces(fs, schemas, groups, linesOf)].flat()
      const { text, map } = buildDoc(fs, schemas, groups, linesOf)
      expect(lines.join('\n')).toBe(text.toString())
      expect(docMapOf(fs, schemas, groups, linesOf)).toEqual(map)
    }
  })

  it('re-parses only the edited feature', () => {
    const { text, map } = built()
    const cs = edit(text, map, 2, '"name": "c"', '"name": "typed"')
    const res = parseEdits(text, map, cs, cs.apply(text))
    expect(res.kind).toBe('ok')
    if (res.kind !== 'ok') return
    expect((res.features[2] as GeoJSONFeature).properties.name).toBe('typed')
    res.features.forEach((f, i) => { if (i !== 2) expect(f).toBe(base[i]) })
    expect(res.counts).toEqual(map.counts)
  })

  it('maps several edits, keeps line counts right, and the map keeps patching', () => {
    const { text, map } = built()
    // Feature 1 gains two lines, feature 3 changes in place.
    const a = edit(text, map, 1, '"note"', '"extra": 1,\n"more": 2,\n        "note"')
    const mid = a.apply(text)
    const b = edit(mid, { ...map, counts: map.counts.map((c, i) => (i === 1 ? c + 2 : c)) }, 3, '"schemaId": "s1",', '"schemaId": "s2",')
    const cs = a.compose(b)
    const doc = cs.apply(text)
    const res = parseEdits(text, map, cs, doc)
    if (res.kind !== 'ok' || !res.counts) throw new Error(`expected ok with counts, got ${res.kind}`)
    expect(res.counts[1]).toBe(map.counts[1] + 2)
    expect((res.features[1] as GeoJSONFeature).properties.more).toBe(2)
    expect((res.features[3] as GeoJSONFeature).schemaId).toBe('s2')
    expect(res.features.filter((f, i) => f !== base[i])).toHaveLength(2)
    // The updated map describes `doc`: a store patch to feature 4 lands exactly.
    const fs = res.features as GeoJSONFeature[]
    const next = [...fs]; next[4] = pt('e', 7)
    const patch = diffDoc(doc, { ...map, features: fs, counts: res.counts }, next, schemas, groups, linesOf)!
    const after = JSON.parse(ChangeSet.of(patch.changes, doc.length).apply(doc).toString())
    expect(after.features[4].geometry.coordinates).toEqual([7, 2])
    expect(after.features[1].properties.more).toBe(2)
  })

  it('asks for a full parse in the header or footer; a separator edit re-parses both neighbours', () => {
    const { text, map } = built()
    const header = text.toString().indexOf('"metadata"')
    expect(parseEdits(text, map, ChangeSet.of({ from: header, insert: ' ' }, text.length), text).kind).toBe('full')
    // The comma after feature 0: without it features 0 and 1 don't parse as a list.
    const comma = text.line(featureStartLines(map)[1]).from - 2
    expect(text.sliceString(comma, comma + 1)).toBe(',')
    const cs = ChangeSet.of({ from: comma, to: comma + 1 }, text.length)
    expect(parseEdits(text, map, cs, cs.apply(text)).kind).toBe('invalid')
    // The footer.
    expect(parseEdits(text, map, ChangeSet.of({ from: text.length - 1, insert: ' ' }, text.length), text).kind).toBe('full')
  })

  it('reports mid-typing as invalid', () => {
    const { text, map } = built()
    for (const insert of ['"name": "c', '"name": "c", {']) {
      const cs = edit(text, map, 2, '"name": "c"', insert)
      const doc = cs.apply(text)
      const res = parseEdits(text, map, cs, doc)
      if (res.kind !== 'invalid') throw new Error(res.kind)
      // The failing run: feature 2's text in the new document.
      expect(doc.sliceString(res.from, res.to)).toContain(insert)
      expect(doc.sliceString(res.from, res.from + 5)).toBe('    {')
    }
    // A trailing comma mid-typing reads leniently: same object.
    const cs = edit(text, map, 2, '"name": "c"', '"name": "c",')
    const res = parseEdits(text, map, cs, cs.apply(text))
    if (res.kind !== 'ok') throw new Error(res.kind)
    expect((res.features[2] as GeoJSONFeature).properties.name).toBe('c')
  })

  it('reads a feature without a valid geometry as mid-typing, not as an edit', () => {
    const { text, map } = built()
    // The geometry lines deleted to retype them.
    const from = text.toString().indexOf('      "geometry"', text.line(featureStartLines(map)[2]).from)
    const to = text.toString().indexOf('      "properties"', from)
    const cs = ChangeSet.of({ from, to }, text.length)
    expect(parseEdits(text, map, cs, cs.apply(text)).kind).toBe('invalid')
    for (const [find, insert] of [['"type": "Point"', '"type": "Poin"'], ['"type": "Feature"', '"type": "Featur"'], ['"coordinates": [', '"coordinates": null, "x": [']]) {
      const e = edit(text, map, 2, find, insert)
      expect(parseEdits(text, map, e, e.apply(text)).kind).toBe('invalid')
    }
    expect(isFeature(pt('a'))).toBe(true)
    expect(isFeature({ type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [pt('a').geometry] }, properties: {} })).toBe(true)
    expect(isFeature({ type: 'Feature', geometry: null, properties: {} })).toBe(false)
    expect(isFeature({ type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point' }] } })).toBe(false)
  })

  it('deletes a feature whose text was emptied; the stray comma sends it to a full parse', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    const from = text.line(starts[2]).from
    const to = text.line(starts[2] + map.counts[2] - 1).to - 1 // keeps the comma: `},\n,\n{`
    const cs = ChangeSet.of({ from, to }, text.length)
    const doc = cs.apply(text)
    const res = parseEdits(text, map, cs, doc)
    if (res.kind !== 'ok' || !res.counts) throw new Error(res.kind)
    expect(res.features.map((f) => (f as GeoJSONFeature).id)).toEqual(['a', 'b', 'd', 'e'])
    expect(separatorFixes(doc, map.headerLines, res.counts, res.around)).toBeNull()
    expect((parseLenient(doc.toString()) as { features: GeoJSONFeature[] }).features.map((f) => f.id)).toEqual(['a', 'b', 'd', 'e'])
  })

  // Deletes feature lines [first, last] (whole lines, as selecting them and pressing Backspace does).
  const deleteLines = (text: Text, first: number, last: number) =>
    ChangeSet.of({ from: text.line(first).from, to: last < text.lines ? text.line(last + 1).from : text.length }, text.length)

  it.each([
    ['the first', 0], ['a middle', 2], ['the last', 4],
  ])('deleting %s feature by whole lines keeps the map, and the text matches a fresh build', (_, k) => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    // The last feature's lines are taken with the line break before them, as a
    // selection from the end of the previous feature would; it leaves that one's comma.
    const cs = k === 4
      ? ChangeSet.of({ from: text.line(starts[4]).from - 1, to: text.line(starts[4] + map.counts[4] - 1).to }, text.length)
      : deleteLines(text, starts[k], starts[k] + map.counts[k] - 1)
    let doc = cs.apply(text)
    const res = parseEdits(text, map, cs, doc)
    if (res.kind !== 'ok' || !res.counts) throw new Error(res.kind)
    const next = base.filter((_, i) => i !== k)
    expect(res.features.map((f) => (f as GeoJSONFeature).id)).toEqual(next.map((f) => f.id))
    const fixes = separatorFixes(doc, map.headerLines, res.counts, res.around)
    expect(fixes).not.toBeNull()
    expect(fixes!.length).toBe(k === 4 ? 1 : 0)
    doc = ChangeSet.of(fixes!, doc.length).apply(doc)
    expect(doc.toString()).toBe(buildDoc(next, schemas, groups, linesOf).text.toString())
    expect(res.counts).toEqual(buildDoc(next, schemas, groups, linesOf).map.counts)
  })

  it('deletes a run of features in one edit', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    const cs = deleteLines(text, starts[1], starts[3] + map.counts[3] - 1)
    const res = parseEdits(text, map, cs, cs.apply(text))
    if (res.kind !== 'ok' || !res.counts) throw new Error(res.kind)
    expect(res.features.map((f) => (f as GeoJSONFeature).id)).toEqual(['a', 'e'])
    expect(res.features[0]).toBe(base[0])
    expect(separatorFixes(cs.apply(text), map.headerLines, res.counts, res.around)).toEqual([])
  })

  it('splits one feature into two, dropping the line counts', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    const end = text.line(starts[2] + map.counts[2] - 1).to - 1 // after feature 2's `}`
    const cs = ChangeSet.of({ from: end, insert: ',\n    ' + JSON.stringify(pt('new')) }, text.length)
    const res = parseEdits(text, map, cs, cs.apply(text))
    if (res.kind !== 'ok') throw new Error(res.kind)
    expect(res.counts).toBeNull()
    expect(res.features.map((f) => (f as GeoJSONFeature).id)).toEqual(['a', 'b', 'c', 'new', 'd', 'e'])
  })

  // After a commit the runs are rewritten as the store prints them: the text
  // then equals a fresh build and the counts are its map's (the map survives).
  const canonical = (text: Text, map: ReturnType<typeof built>['map'], cs: ChangeSet) => {
    const doc = cs.apply(text)
    const res = parseEdits(text, map, cs, doc)
    if (res.kind !== 'ok') throw new Error(res.kind)
    const fs = res.features as GeoJSONFeature[]
    const canon = canonicalRuns(text, map, cs, doc, res.runs, fs, linesOf)
    const fresh = buildDoc(fs, schemas, groups, linesOf)
    expect(ChangeSet.of(canon.changes, doc.length).apply(doc).toString()).toBe(fresh.text.toString())
    expect(canon.counts).toEqual(fresh.map.counts)
    return { fs, canon }
  }

  it('rewrites a split run as buildDoc prints it, keeping the map', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    const end = text.line(starts[2] + map.counts[2] - 1).to - 1
    const { fs, canon } = canonical(text, map, ChangeSet.of({ from: end, insert: ',\n    ' + JSON.stringify(pt('new')) }, text.length))
    expect(fs.map((f) => f.id)).toEqual(['a', 'b', 'c', 'new', 'd', 'e'])
    // Only the one-line paste is rewritten, not the features around it.
    expect(canon.changes).toHaveLength(1)
  })

  it('rewrites an edit spanning two features (same count), the first and the last', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    // Join features 1 and 2 onto one line each side of the separator: still two features.
    const sepFrom = text.line(starts[2] - 1).to - 2 // `}` of feature 1
    const sepTo = text.line(starts[2]).to // `{` of feature 2
    canonical(text, map, ChangeSet.of({ from: sepFrom, to: sepTo, insert: '}, {' }, text.length))
    // The first two and the last two, each pair across its separator.
    const a = text.line(starts[1] - 1).to - 2
    canonical(text, map, ChangeSet.of({ from: a, to: text.line(starts[1]).to, insert: '},{' }, text.length))
    const b = text.line(starts[4] - 1).to - 2
    canonical(text, map, ChangeSet.of({ from: b, to: text.line(starts[4]).to, insert: '},\n{' }, text.length))
  })

  it('a pasted feature already in buildDoc\'s shape is left alone', () => {
    const { text, map } = built()
    const starts = featureStartLines(map)
    const end = text.line(starts[2] + map.counts[2] - 1).to - 1
    const { canon } = canonical(text, map, ChangeSet.of({ from: end + 1, insert: '\n' + featureLines(pt('new')).join('\n') + ',' }, text.length))
    expect(canon.changes).toHaveLength(0)
  })

  it('smallestChange keeps the common prefix and suffix', () => {
    expect(smallestChange('abcXdef', 'abcYYdef', 10)).toEqual({ from: 13, to: 14, insert: 'YY' })
    expect(smallestChange('aaa', 'aaa')).toBeNull()
    expect(smallestChange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
  })

  it('leaves the text alone when a new object prints the same', () => {
    const { text, map } = built()
    const next = base.map((f, i) => (i === 1 ? { ...f, _validation: { errors: ['y'], warnings: [] } } : f))
    expect(diffDoc(text, map, next, schemas, groups, linesOf)!.changes).toHaveLength(0)
  })

  it('detects overlapping change sets', () => {
    const doc = Text.of(['0123456789'])
    const at = (from: number, to: number) => ChangeSet.of({ from, to, insert: 'x' }, doc.length)
    expect(changesOverlap(at(1, 3), at(5, 6))).toBe(false)
    expect(changesOverlap(at(1, 3), at(3, 4))).toBe(true)
    expect(changesOverlap(at(1, 5), at(2, 3))).toBe(true)
  })
})

describe('parseLenient', () => {
  it('reads an empty document as an empty collection', () => {
    expect(parseLenient('  \n')).toEqual({ type: 'FeatureCollection', features: [] })
  })
  it('drops the stray commas that deleting whole lines leaves', () => {
    expect(parseLenient('{"features":[{"a":1},\n]}')).toEqual({ features: [{ a: 1 }] })
    expect(parseLenient('{"features":[,{"a":1}]}')).toEqual({ features: [{ a: 1 }] })
    expect(parseLenient('{"features":[{"a":1},,{"b":2}]}')).toEqual({ features: [{ a: 1 }, { b: 2 }] })
    expect(parseLenient('{"a":1,}')).toEqual({ a: 1 })
  })
  it('leaves commas inside strings alone, and gives up on real syntax errors', () => {
    expect(parseLenient('{"s":"a,]b\\",}","x":[1,2,]}')).toEqual({ s: 'a,]b",}', x: [1, 2] })
    expect(parseLenient('{"a":')).toBeNull()
  })
})

describe('jsonError', () => {
  it('is null for what parseLenient reads, stray commas included', () => {
    for (const t of ['', '{"a":[1,2,]}', '{"features":[,{"a":1},,{"b":-1.5e3}]}', '[true,false,null,"\\u00e9\\n"]', '{"a":1,}\n']) {
      expect(parseLenient(t)).not.toBeNull()
      expect(jsonError(t)).toBeNull()
    }
  })
  it('points at the first error, in plain words', () => {
    const at = (t: string) => { const e = jsonError(t); return e && [e.pos, e.message] }
    expect(at('{"a": 1 "b": 2}')).toEqual([8, 'Expected a comma or a closing }'])
    expect(at('[1 2]')).toEqual([3, 'Expected a comma or a closing ]'])
    expect(at('{a: 1}')).toEqual([1, 'Expected a property name in double quotes'])
    expect(at('{"a" 1}')).toEqual([5, 'Expected a colon after the property name'])
    expect(at('{"a": nope}')).toEqual([6, 'Expected a value (text needs double quotes)'])
    expect(at('{"a": "b\n"}')).toEqual([6, 'Missing a closing quote'])
    expect(at('{"a": "\\x"}')).toEqual([7, 'Invalid escape in a string (a backslash must be doubled)'])
    expect(at('{"a": [1, 2}')).toEqual([11, 'Expected a comma or a closing ]'])
    expect(at('{"a": 1')).toEqual([7, 'Missing a closing }'])
    expect(at('{"a": -}')).toEqual([6, 'Invalid number'])
    expect(at('{} x')).toEqual([3, 'Unexpected text after the end'])
    expect(at('{"a":,1}')).toEqual([5, 'Expected a value (text needs double quotes)'])
  })
  it('names what makes parsed text not a feature', () => {
    expect(featureIssue(1)).toMatch(/Expected a feature/)
    expect(featureIssue({ type: 'Featur', geometry: { type: 'Point', coordinates: [0, 0] } })).toBe('A feature needs "type": "Feature"')
    expect(featureIssue({ type: 'Feature', geometry: { type: 'Poin', coordinates: [0, 0] } })).toMatch(/geometry/)
  })
})

describe('featureIndexAtLine', () => {
  it('maps a line to the feature that holds it, -1 outside features', () => {
    const fs = [
      { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} },
    ] as GeoJSONFeature[]
    const { text, map } = buildDoc(fs, [], [], featureLines)
    const starts = featureStartLines(map)
    expect(featureIndexAtLine(map, 1)).toBe(-1)
    expect(featureIndexAtLine(map, starts[0])).toBe(0)
    expect(featureIndexAtLine(map, starts[1] - 1)).toBe(0)
    expect(featureIndexAtLine(map, starts[1])).toBe(1)
    expect(featureIndexAtLine(map, text.lines)).toBe(-1)
  })
})
