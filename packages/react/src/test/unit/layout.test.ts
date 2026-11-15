import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveConfig, resolveLayout, DEFAULT_LAYOUT, LAYOUT_SLOTS, isControlVisible, visibleLayoutEntries, withLayout, layoutGaps,
  type ElementEditorConfig, type LayoutConfig, type LayoutControl, type LayoutEntry, type LayoutPatch,
} from '../../../../ui/src/contexts/ElementEditorConfigContext'

const S = 'separator' as const
const items = (r: ReturnType<typeof resolveConfig>) =>
  Object.fromEntries(LAYOUT_SLOTS.map((s) => [s, r.ui.layout[s].items]).filter(([, v]) => (v as unknown[]).length))
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
const msgs = (w: ReturnType<typeof spyWarn>) => w.mock.calls.map((c) => String(c[0]))

afterEach(() => vi.restoreAllMocks())

describe('default layout', () => {
  it('matches DEFAULT_LAYOUT with today\'s directions, and warns nothing', () => {
    const w = spyWarn()
    const r = resolveConfig()
    expect(items(r)).toEqual(DEFAULT_LAYOUT)
    expect(r.ui.layout.leftCenter.direction).toBe('vertical')
    expect(r.ui.layout.bottomLeft.direction).toBe('horizontal')
    expect(r.toolbar.position).toBe('top-center')
    expect(w).not.toHaveBeenCalled()
  })
})

describe('toolbar options', () => {
  it('toolbar.direction is kept, no warning; toolbar.position follows the toolbar slot', () => {
    const w = spyWarn()
    expect(resolveConfig({ toolbar: { direction: 'vertical' } }).toolbar.direction).toBe('vertical')
    expect(resolveConfig({ ui: { layout: { bottomRight: ['toolbar'] } } }).toolbar.position).toBe('bottom-right')
    expect(resolveConfig({ ui: { layout: { leftCenter: ['toolbar'] } } }).toolbar.position).toBe('left-center')
    expect(w).not.toHaveBeenCalled()
  })
})

describe('ui.layout', () => {
  it('unlisted controls are hidden; toolbar unplaced keeps a fallback position', () => {
    const r = resolveConfig({ ui: { layout: { statusRight: ['locate'] } } })
    expect(items(r)).toEqual({ statusRight: ['locate'] })
    expect(r.toolbar.position).toBe('top-center')
  })

  it('slot directions: array → default, object → given; status slots always horizontal', () => {
    const l = resolveLayout({
      leftCenter: ['undo'],
      rightCenter: { items: ['redo'], direction: 'horizontal' },
      topLeft: { items: ['table'], direction: 'vertical' },
      bottomRight: ['schema'],
      statusLeft: { items: ['locate'], direction: 'vertical' } as never, // JS callers: direction ignored
    })
    expect(l.leftCenter.direction).toBe('vertical')
    expect(l.rightCenter.direction).toBe('horizontal')
    expect(l.topLeft.direction).toBe('vertical')
    expect(l.bottomRight.direction).toBe('horizontal')
    expect(l.statusLeft.direction).toBe('horizontal')
  })

  it('duplicates: first place wins in slot order, then array order', () => {
    const w = spyWarn()
    // statusLeft comes after bottomLeft in slot order even though it's written first.
    const l = resolveLayout({ statusLeft: ['locate'], bottomLeft: ['locate', 'table', { group: ['table', 'schema'] }] })
    expect(l.bottomLeft.items).toEqual(['locate', 'table', { group: ['schema'] }])
    expect(l.statusLeft.items).toEqual([])
    expect(msgs(w).some((m) => m.includes("'locate' is in both bottomLeft and statusLeft; keeping bottomLeft")
      && m.includes("withLayout({ move: { locate: 'statusLeft' } })"))).toBe(true)
    expect(msgs(w).some((m) => m.includes("'table' is listed twice in bottomLeft"))).toBe(true)
  })

  it('invalid placements are dropped with a warning', () => {
    const w = spyWarn()
    const l = resolveLayout({
      topLeft: ['attribution' as never, 'nope' as never, 42 as never, 'fitBounds'],
      statusLeft: ['toolbar' as never, 'applyChanges' as never, 'keyboard'],
      bottomLeft: [{ group: ['toolbar' as never, 'locate'] }],
    })
    expect(l.topLeft.items).toEqual(['fitBounds'])
    expect(l.statusLeft.items).toEqual(['keyboard'])
    expect(l.bottomLeft.items).toEqual([{ group: ['locate'] }])
    const all = msgs(w).join('\n')
    expect(all).toContain("'attribution' can only go in statusLeft or statusRight")
    expect(all).toContain("'nope' is not a control")
    expect(all).toContain("42 is not a control")
    expect(all).toContain("'toolbar' can't go in the status bar")
    expect(all).toContain("'applyChanges' can't go in the status bar")
    expect(all).toContain("'toolbar' can't go in a group")
    // Invalid toolbar placements don't block a later valid one.
    expect(resolveLayout({ topLeft: [{ group: ['toolbar' as never] }], bottomRight: ['toolbar'] }).bottomRight.items).toEqual(['toolbar'])
  })

  it('groups: normalised, nested groups rejected, empty groups dropped, group of one kept', () => {
    const w = spyWarn()
    const l = resolveLayout({
      bottomLeft: [
        { group: [S, 'table', S, S, 'schema', S] },
        { group: [{ group: ['geojson'] } as never, 'settings'] },
        { group: ['nope' as never] },
        { group: ['keyboard'] },
      ],
    })
    expect(l.bottomLeft.items).toEqual([{ group: ['table', S, 'schema'] }, { group: ['settings'] }, { group: ['keyboard'] }])
    expect(msgs(w).some((m) => m.includes("groups can't be nested"))).toBe(true)
    // the nested group's controls weren't consumed: geojson can still be placed
    expect(resolveLayout({ topLeft: [{ group: [{ group: ['geojson'] } as never] }], topRight: ['geojson'] }).topRight.items).toEqual(['geojson'])
  })

  it('separators: any number in status slots and groups, edge/double ones collapse', () => {
    const l = resolveLayout({ statusLeft: [S, S, 'table', S, S, S, 'schema', S], bottomLeft: [{ group: [S, 'locate', S, S, 'settings'] }] })
    expect(l.statusLeft.items).toEqual(['table', S, 'schema'])
    expect(l.bottomLeft.items).toEqual([{ group: ['locate', S, 'settings'] }])
    expect(resolveLayout({ statusRight: [S, S] }).statusRight.items).toEqual([])
  })

  it('a separator directly in a map slot is dropped with one warning that points to groups', () => {
    const w = spyWarn()
    const l = resolveLayout({ bottomLeft: ['table', S as never, 'schema', S as never], leftCenter: [S as never, { group: ['undo', S, 'redo'] }] })
    expect(l.bottomLeft.items).toEqual(['table', 'schema'])
    expect(l.leftCenter.items).toEqual([{ group: ['undo', S, 'redo'] }])
    const bl = msgs(w).filter((m) => m.includes('config.ui.layout.bottomLeft') && m.includes("'separator' only goes inside a group or in the status bar"))
    expect(bl).toHaveLength(1)
    expect(bl[0]).toContain('{ group: [...] }')
    expect(msgs(w).some((m) => m.includes('config.ui.layout.leftCenter'))).toBe(true)
  })

  it('attribution is allowed in either status slot (also in a group), first one wins', () => {
    spyWarn()
    expect(resolveLayout({ statusRight: [{ group: ['locate', 'attribution'] }] }).statusRight.items)
      .toEqual([{ group: ['locate', 'attribution'] }])
    const l = resolveLayout({ statusLeft: ['attribution'], statusRight: ['attribution'] })
    expect([l.statusLeft.items, l.statusRight.items]).toEqual([['attribution'], []])
  })
})

describe('visibility on top of layout', () => {
  const ctx = { readonly: false, canSubmit: false, hasBasemaps: false }
  const run = (layout: LayoutConfig, cfg: ElementEditorConfig['ui'] = {}, c = ctx) => {
    const r = resolveConfig({ ui: { ...cfg, layout } })
    return LAYOUT_SLOTS.map((s) => visibleLayoutEntries(r.ui.layout[s].items, (id) => isControlVisible(id, r.ui, c)))
      .filter((e) => e.length)
  }

  it('hidden controls drop out; separators then collapse, also inside groups', () => {
    expect(run({ statusLeft: ['fitBounds', S, 'table', S, 'locate'] }, { dataTable: false }))
      .toEqual([['fitBounds', S, 'locate']])
    expect(run({ bottomLeft: [{ group: ['fitBounds', S, 'table', S, 'locate'] }] }, { dataTable: false, locateButton: false }))
      .toEqual([[{ group: ['fitBounds'] }]])
  })

  it('a group whose controls are all hidden disappears, with its separators', () => {
    expect(run({ statusLeft: ['settings', S, { group: ['schema', S, 'geojson'] }, S, 'keyboard'] }, { geojsonEditor: false }, { readonly: true, canSubmit: true, hasBasemaps: false }))
      .toEqual([['settings', S, 'keyboard']])
    expect(run({ bottomLeft: ['settings', { group: ['schema', S, 'applyChanges'] }, 'keyboard'] }, {}, { readonly: true, canSubmit: true, hasBasemaps: false }))
      .toEqual([['settings', 'keyboard']])
  })

  it('a status slot of only hidden controls ends up empty (bar not rendered)', () => {
    expect(run({ statusLeft: ['schema', S], statusRight: [{ group: ['schema'] }] }, {}, { readonly: true, canSubmit: false, hasBasemaps: false })).toEqual([])
  })

  it('isControlVisible mirrors the visibility flags and readonly', () => {
    const vis = (cfg: ElementEditorConfig, c = ctx) => (id: LayoutControl) => isControlVisible(id, resolveConfig(cfg).ui, c)
    const all = vis({})
    for (const id of ['fitBounds', 'locate', 'zoomIndicator', 'table', 'schema', 'geojson', 'settings', 'keyboard', 'toolbar', 'attribution', 'undo', 'redo'] as const) {
      expect(all(id)).toBe(true)
    }
    expect(vis({}, { readonly: true, canSubmit: false, hasBasemaps: false })('schema')).toBe(false)
    expect(vis({ ui: { zoomToAll: false } })('fitBounds')).toBe(false)
    expect(vis({ ui: { locateButton: false } })('locate')).toBe(false)
    expect(vis({ ui: { zoomIndicator: false } })('zoomIndicator')).toBe(false)
    expect(vis({ ui: { keyboardShortcuts: { show: false } } })('keyboard')).toBe(false)
    expect(vis({ ui: { dataTable: false } })('table')).toBe(false)
    expect(vis({ ui: { geojsonEditor: false } })('geojson')).toBe(false)
    expect(vis({ ui: { settings: false } })('settings')).toBe(false)
  })

  it('DEFAULT_LAYOUT is deep-frozen (shared by every editor on the page)', () => {
    const group = DEFAULT_LAYOUT.leftCenter as LayoutEntry[]
    expect(Object.isFrozen(DEFAULT_LAYOUT)).toBe(true)
    expect(() => (DEFAULT_LAYOUT.bottomLeft as LayoutEntry[]).push('table')).toThrow()
    expect(Object.isFrozen((group[0] as { group: unknown[] }).group)).toBe(true)
    // Spreading it into a host layout still works and resolves.
    expect(resolveLayout({ ...DEFAULT_LAYOUT, statusRight: ['attribution'] }).statusRight.items).toEqual(['attribution'])
  })

  it("'basemap' needs hasBasemaps; it is first in the default bottom-left", () => {
    expect((DEFAULT_LAYOUT.bottomLeft as LayoutEntry[])[0]).toBe('basemap')
    expect(run({ bottomRight: ['basemap', 'undo'] })).toEqual([['undo']])
    expect(run({ bottomRight: ['basemap', 'undo'] }, {}, { ...ctx, hasBasemaps: true })).toEqual([['basemap', 'undo']])
  })

  it("'basemap' can't go in a group (it opens a panel); it can sit in the status bar", () => {
    const w = spyWarn()
    // @ts-expect-error -- 'basemap' is not a group member by type either; the resolver must still drop it.
    const l = resolveLayout({ bottomLeft: [{ group: ['basemap', 'locate'] }], statusLeft: ['basemap'] })
    expect(l.bottomLeft.items).toEqual([{ group: ['locate'] }])
    expect(l.statusLeft.items).toEqual(['basemap'])
    expect(msgs(w).some((m) => m.includes("'basemap' can't go in a group"))).toBe(true)
  })

  it('applyChanges needs onSubmit and not readonly; undo/redo always visible', () => {
    expect(run({ bottomRight: ['applyChanges', 'undo', 'redo'] })).toEqual([['undo', 'redo']])
    expect(run({ bottomRight: ['applyChanges'] }, {}, { readonly: false, canSubmit: true, hasBasemaps: false })).toEqual([['applyChanges']])
    expect(run({ bottomRight: ['applyChanges'] }, {}, { readonly: true, canSubmit: true, hasBasemaps: false })).toEqual([])
  })
})

describe('withLayout', () => {
  const W = (patch: LayoutPatch, base?: LayoutConfig) => {
    const r = resolveLayout(withLayout(patch, base))
    return Object.fromEntries(LAYOUT_SLOTS.map((s) => [s, r[s].items]).filter(([, v]) => (v as unknown[]).length))
  }

  it('moves one control and keeps the rest of the default, without warnings', () => {
    const w = spyWarn()
    expect(W({ move: { table: 'bottomRight' } })).toEqual({
      topCenter: ['toolbar'],
      leftCenter: [{ group: ['undo', 'redo'] }],
      bottomLeft: ['basemap', 'fitBounds', 'locate', 'zoomIndicator', 'schema', 'geojson', 'settings', 'keyboard', 'applyChanges'],
      bottomRight: ['table'],
    })
    expect(w).not.toHaveBeenCalled()
  })

  it("adds an unplaced control, at the end or with at: 'start'; moving within a slot reorders", () => {
    expect(W({ move: { attribution: 'statusRight' } }).statusRight).toEqual(['attribution'])
    expect(W({ move: { applyChanges: { slot: 'bottomLeft', at: 'start' } } }).bottomLeft?.slice(0, 2)).toEqual(['applyChanges', 'basemap'])
    expect(W({ move: { toolbar: { slot: 'topCenter', at: 'start' } } }, { topCenter: ['table', 'toolbar'] }).topCenter).toEqual(['toolbar', 'table'])
  })

  it('moving out of a group keeps the rest of the group; an emptied group and its separators go', () => {
    expect(W({ move: { undo: 'statusLeft' } })).toMatchObject({ leftCenter: [{ group: ['redo'] }], statusLeft: ['undo'] })
    expect(W({ hide: ['undo', 'redo'] }).leftCenter).toBeUndefined()
    expect(withLayout({ hide: ['schema'] }, { bottomLeft: [{ group: ['table', 'separator', 'schema'] }] }))
      .toEqual({ bottomLeft: [{ group: ['table'] }] })
    expect(withLayout({ hide: ['undo'] }, { statusLeft: ['undo', 'separator', 'keyboard'] })).toEqual({ statusLeft: ['keyboard'] })
  })

  it('keeps { items, direction } slots, never touches the frozen base', () => {
    const base: LayoutConfig = { rightCenter: { items: ['table', 'schema'], direction: 'horizontal' } }
    expect(withLayout({ hide: ['schema'] }, base)).toEqual({ rightCenter: { items: ['table'], direction: 'horizontal' } })
    expect(base.rightCenter).toEqual({ items: ['table', 'schema'], direction: 'horizontal' })
    const out = withLayout({ move: { table: 'topRight' } })
    expect(Object.isFrozen(out.bottomLeft)).toBe(false)
    expect((DEFAULT_LAYOUT.bottomLeft as LayoutEntry[])).toContain('table')
  })

  it('hide wins over move; unknown controls and slots are skipped with a warning', () => {
    const w = spyWarn()
    expect(W({ move: { table: 'topRight' }, hide: ['table'] }).topRight).toBeUndefined()
    const bad = withLayout({ move: { nope: 'topLeft', locate: 'middle' }, hide: ['zap'] } as never)
    expect(bad.topLeft).toBeUndefined()
    expect(bad.bottomLeft).not.toContain('locate') // moved away, target ignored
    const all = msgs(w).join('\n')
    expect(all).toContain("withLayout: 'table' is both moved and hidden; hiding it")
    expect(all).toContain("withLayout: 'nope' is not a control")
    expect(all).toContain("withLayout: 'zap' is not a control")
    expect(all).toContain("withLayout: 'middle' is not a slot (moving 'locate')")
  })

  it('a move into a slot the control cannot go to is still dropped by the resolver (JS callers)', () => {
    spyWarn() // (the resolver's warning was already emitted once above)
    expect(W({ move: { toolbar: 'statusLeft' as never } })).not.toHaveProperty('statusLeft')
    expect(W({ move: { toolbar: 'statusLeft' as never } })).not.toHaveProperty('topCenter')
  })
})

describe('layoutGaps', () => {
  const ctx = { readonly: false, canSubmit: false, tools: null as readonly string[] | null, shortcuts: true }
  const gaps = (layout: LayoutConfig, c: Partial<typeof ctx> = {}) => layoutGaps(resolveLayout(layout), { ...ctx, ...c })

  it('the default layout has no gaps', () => {
    expect(gaps(DEFAULT_LAYOUT, { canSubmit: true, shortcuts: false })).toEqual([])
  })

  it('an unplaced toolbar while drawing is possible', () => {
    expect(gaps({ topLeft: ['table'] })).toEqual([expect.stringContaining("'toolbar' isn't placed, so the drawing tools are reachable only by keyboard shortcut")])
    expect(gaps({ topLeft: ['table'] }, { shortcuts: false })[0]).toContain('the drawing tools are unreachable')
    expect(gaps({}, { readonly: true })).toEqual([])
    expect(gaps({}, { tools: [] })).toEqual([])
    // A toolbar dropped as invalid (status bar) still counts as unplaced.
    expect(gaps({ statusLeft: ['toolbar' as never] })).toHaveLength(1)
  })

  it('onSubmit without applyChanges; undo/redo with shortcuts off; placement inside groups counts', () => {
    const w = spyWarn()
    expect(gaps({ topCenter: ['toolbar'] }, { canSubmit: true })).toEqual([expect.stringContaining("onSubmit is set but 'applyChanges' isn't placed")])
    expect(gaps({ topCenter: ['toolbar'] }, { canSubmit: true, readonly: true })).toEqual([])
    expect(gaps({ topCenter: ['toolbar'], statusLeft: [{ group: ['undo'] }] }, { shortcuts: false }))
      .toEqual(["'redo' isn't placed and keyboard shortcuts are off, so users can't redo"])
    expect(gaps({ topCenter: ['toolbar'] }, { shortcuts: false })[0]).toContain("'undo' and 'redo' aren't placed")
    // A flag-hidden control is still placed: no gap.
    expect(layoutGaps(resolveConfig({ ui: { layout: DEFAULT_LAYOUT, dataTable: false } }).ui.layout, ctx)).toEqual([])
    w.mockRestore()
  })
})
