# Configuring the editor layout

*Where every button sits, how buttons group and stack, and how to slot your own UI alongside the built-ins.*

`<ElementEditor>` places every built-in control through one option: **`config.ui.layout`**, a map of *slots* to ordered *entries*. The drawing toolbar, undo and redo, the small map buttons, the status bar and the map attribution all go through it.

> Configuring this visually first is much faster: [open the playground](https://elementeditor.dev/playground), drag the knobs around, copy the resulting code.

---

## Live preview

<iframe
  src="https://elementeditor.dev/embed?embedded=true"
  width="100%"
  height="640"
  style="border: 0; border-radius: 12px;"
></iframe>

---

## Slots

Ten slots: eight on the map and two in the status bar under it.

```
┌──────────────────────────────────────────────┐
│ topLeft          topCenter          topRight │
│                                              │
│ leftCenter                       rightCenter │
│                                              │
│ bottomLeft      bottomCenter     bottomRight │
├──────────────────────────────────────────────┤
│ statusLeft                       statusRight │  ← status bar
└──────────────────────────────────────────────┘
```

```tsx
<ElementEditor
  config={{
    ui: {
      layout: {
        topCenter:   ['toolbar'],
        leftCenter:  [{ group: ['undo', 'redo'] }],
        bottomLeft:  ['fitBounds', 'locate', { group: ['table', 'separator', 'schema'] }],
        bottomRight: { items: ['settings', 'keyboard'], direction: 'vertical' },
        statusLeft:  ['zoomIndicator'],
        statusRight: ['attribution'],
      },
    },
  }}
/>
```

- **Order.** Entries render in array order. The **first entry sits at the slot's edge**: in the right slots it's the rightmost, in the bottom slots the lowest (vertical) one. Center slots are centered on their edge. In the status bar, `statusLeft` sits at the left edge and `statusRight` at the right edge, both read left to right.
- **Direction.** A slot is an array, or `{ items, direction }` to pick `'horizontal'` or `'vertical'`. Defaults: `leftCenter` and `rightCenter` vertical, every other slot horizontal. The status bar is always horizontal.
- **No overlap.** The three slots on the top edge share one row, and so do the three on the bottom edge. They push each other aside instead of overlapping; if they don't fit side by side, the row wraps. On the left and right edges, `leftCenter` / `rightCenter` stay centered while there's room and otherwise move down (or up) to clear the slots above and below them, e.g. a tall vertical `topLeft` column. Right-side slots stay clear of the open layers panel, and bottom slots ride above the data table (and above the bottom panel in `layout="split"`).
- **Narrow editors.** Layout follows the editor's own width, not the window's, so an embedded editor behaves the same as a full-page one. When a row is too narrow, a slot wraps its own buttons onto a second line (bottom slots wrap upwards), the drawing toolbar's search box turns into a magnifying-glass button whose box opens under the toolbar, and if the tools still don't fit the toolbar wraps too. Below 640 px the layers panel starts collapsed and, like the docked GeoJSON inspector, opens on top of the map instead of beside it (the buttons don't move aside for it). The editing toolbars at the bottom always stay inside the map and wrap when they have to.
- **Editing toolbars.** The toolbars that appear while you edit (selected-feature actions, drawing, Simplify/Smooth/Buffer, the read-only banner) keep their spot at the bottom center. Entries you put in `bottomCenter` sit below them. If they'd overlap `bottomLeft` or `bottomRight`, they move up above the bottom row.

### Default

With no `layout`, the editor uses `DEFAULT_LAYOUT`:

```ts
{
  topCenter:  ['toolbar'],
  leftCenter: [{ group: ['undo', 'redo'] }],
  bottomLeft: ['basemap', 'fitBounds', 'locate', 'zoomIndicator', 'table', 'schema', 'geojson', 'settings', 'keyboard', 'applyChanges'],
}
```

Once you set `layout`, you take full control: **a control you don't list is hidden** (except the map attribution, see below).

### Moving one control: `withLayout`

To move, add or hide a few controls and keep everything else where it is, use `withLayout(patch, base = DEFAULT_LAYOUT)`. It returns a plain layout object:

```tsx
import { withLayout } from '@element-editor/react'

// The table button goes top-right; everything else stays put.
config={{ ui: { layout: withLayout({ move: { table: 'topRight' } }) } }}

// Credits into a status bar, locate first in bottom-right, no keyboard button.
config={{ ui: { layout: withLayout({
  move: { attribution: 'statusRight', locate: { slot: 'bottomRight', at: 'start' } },
  hide: ['keyboard'],
}) } }}

// Start from your own layout instead of the default.
config={{ ui: { layout: withLayout({ hide: ['geojson'] }, adminLayout) } }}
```

- **`move`** puts a control in a slot, wherever it was before, or adds it if it wasn't placed. It goes at the end of the slot (farthest from the slot's edge), or first with `{ slot, at: 'start' }`. Moving a control out of a group leaves the rest of the group where it is. To build a new group, write that slot out in full.
- **`hide`** takes controls off the layout and wins over `move`. It only removes the button: the feature stays reachable by keyboard shortcut. To turn the feature off, use its flag (`dataTable: false`, `geojsonEditor: false`, …). The search box and the drawing tools live inside `'toolbar'`; choose them with `config.tools`.
- The slots each control may move to are typed: `move: { toolbar: 'statusLeft' }` or `move: { attribution: 'topLeft' }` doesn't compile.

Spreading `{ ...DEFAULT_LAYOUT, topRight: ['table'] }` lists the table twice (in `topRight` and in the default `bottomLeft`). The [first place in slot order](#entries) wins, so whether the table moves depends on the slots. That's why it logs a development warning that points to `withLayout`.

---

## Entries

| Id | Control |
|---|---|
| `'toolbar'` | The drawing toolbar (tools + place search) |
| `'undo'`, `'redo'` | Undo and redo buttons |
| `'fitBounds'` | Zoom to all features (or to the selection) |
| `'locate'` | Show my location |
| `'zoomIndicator'` | Zoom level (click to type one) |
| `'table'` | Show or hide the data table |
| `'schema'` | Edit schema |
| `'geojson'` | Show GeoJSON |
| `'settings'` | Editor settings |
| `'keyboard'` | Keyboard shortcuts |
| `'applyChanges'` | "Apply changes" button (needs `onSubmit`) |
| `'basemap'` | Basemap picker (first in the default `bottomLeft`). Only shown when the editor has a picker: always on the MapLibre drop-in unless `basemaps={false}`, on the Leaflet drop-in only with two or more `basemaps`. See [Basemaps](./basemaps.md) |
| `'attribution'` | Map tile and data credits (status bar only) |
| `'separator'` | A thin divider line (inside a group, or in the status bar) |
| `{ group: [...] }` | Several controls joined in one pill |

Types: `LayoutConfig` (a map slot takes `MapSlotConfig`, a status slot `StatusSlotConfig`), `MapSlot` / `StatusSlot` / `LayoutSlot`, `LayoutControl`, `MapEntry` / `StatusEntry` / `LayoutEntry`, `MapGroup` / `StatusGroup` / `LayoutGroup`, `LayoutPatch`. Each slot only accepts the entries it can show, so the rules below are compile errors in TypeScript. If you build a layout in a variable, annotate it (`const layout: LayoutConfig = …`) or write `… satisfies LayoutConfig` so the strings stay literal types.

**Rules** (from JavaScript, broken ones are skipped with a warning in development):

- **One place per control.** A control listed twice stays at its first place, reading the slots in the order `topLeft`, `topCenter`, `topRight`, `leftCenter`, `rightCenter`, `bottomLeft`, `bottomCenter`, `bottomRight`, `statusLeft`, `statusRight`.
- `'toolbar'` can't go in the status bar or in a group.
- `'basemap'` can't go in a group. When the editor has no basemap picker the entry is simply not rendered.
- `'applyChanges'` can't go in the status bar.
- `'attribution'` can only go in `statusLeft` / `statusRight`.
- Groups can't contain groups.
- `'separator'` goes inside a group or in a status slot; directly in a map slot it's dropped (put it inside a `{ group: [...] }`).
- A status slot is always an array (the status bar is horizontal); `{ items, direction }` is for map slots.

**Nothing out of reach.** In development the editor also warns once when a layout hides something people need: no `'toolbar'` while drawing is possible (the tools are then reachable only by shortcut; set `readonly` or `tools: []` if that's on purpose), no `'applyChanges'` while `onSubmit` is set, or no undo/redo while keyboard shortcuts are off. Turning a control off with its flag never warns.

### Groups

`{ group: ['table', 'schema', 'geojson'] }` draws the buttons in one joined pill, like the drawing toolbar. A group follows its slot's direction (vertical in `leftCenter` / `rightCenter` by default). A `'separator'` inside a group draws a divider line in the pill. A group of one button is fine. In the status bar a group is a tight cluster of small icons with no gaps.

### Separators

`'separator'` can appear any number of times inside groups and in the status bar slots. It needs a surface to draw on, so a separator directly in a map slot (over the map tiles) is dropped with a warning in development; to divide buttons on the map, put them in a group: `bottomLeft: [{ group: ['table', 'separator', 'schema'] }]`. Separators at the start or end, next to each other, or next to a hidden control are dropped, so hiding a button never leaves a stray line.

### Visibility flags still apply

`layout` decides *where*; the usual flags decide *whether*: `zoomToAll`, `locateButton`, `zoomIndicator`, `dataTable`, `schemaEditor`, `geojsonEditor`, `settings`, `keyboardShortcuts.show`. Schema and "Apply changes" are hidden while `readonly`, and "Apply changes" needs `onSubmit`. A group whose buttons are all hidden disappears.

Undo and redo keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) keep working whether or not the buttons are placed.

### Starting with the GeoJSON inspector open

`ui.geojsonEditorOpen: true` (or `'docked'`, which now means the same) opens the inspector when the editor mounts, which suits demos and embeds that show the data next to the map. It opens in the visitor's last mode: docked on the right by default, or as a floating window once they have undocked it.

```tsx
<ElementEditor layout="minimal" config={{ ui: { geojsonEditorOpen: 'docked' } }} />
```

It is a starting state: the visitor can close or undock it, and a reload opens it again. Once a visitor has clicked Dock / Undock, their saved choice wins. Opening on load doesn't move keyboard focus into the inspector, and the controls clear the dock from the first paint. With `geojsonEditor: false` it stays closed. With an adapter, set it on `<ElementEditorUIProvider config>` and render `GeoJSONModal` while `codeModalOpen` is true, with `<Suspense fallback={<GeoJSONDockPlaceholder />}>`.

---

## Status bar

Put anything in `statusLeft` or `statusRight` and a thin full-width bar appears under the map, with those controls drawn as small icons. It keeps the map free of less important buttons.

```tsx
<ElementEditor
  config={{
    ui: {
      layout: {
        topCenter:   ['toolbar'],
        bottomLeft:  ['basemap', 'fitBounds', 'table', 'schema', 'geojson', 'settings'],
        statusLeft:  [{ group: ['undo', 'redo'] }, 'separator', 'keyboard'],
        statusRight: ['locate', 'zoomIndicator', 'separator', 'attribution'],
      },
    },
  }}
/>
```

- The bar sits **below** the map, so the map, data table and layers panel get shorter by its height (28px) instead of being covered. It stays visible when the data table is full screen.
- If every control in the bar is hidden (say it only holds `'schema'` and the editor is `readonly`), the bar isn't rendered and the map gets the space back.
- **Map attribution.** The credits (the active basemap's, the services in use (Nominatim while search is offered, OpenRouteService while routing through it), the map library's own on Leaflet, and anything your tile layer or `addAttribution` adds) normally sit in the bottom-right corner of the map: expanded at load, then folded behind a round "i" button on the first map interaction or after five seconds ([Basemaps → Attribution](./basemaps.md#attribution)). It is the first entry of the `bottomRight` slot (at the corner, before your own `bottomRight` entries), so when it expands the bottom row wraps around it instead of covering it. `'attribution'` in a status slot moves them into the bar as one line of small grey text with working links; if it doesn't fit it ends in "…" and shows the full text on hover. **When you don't list `'attribution'`, it stays on the map** — attribution is usually a license requirement, so it's never silently removed.

---

## Custom buttons via slots

Need an "Admin" button? Pass JSX through the `slots` prop. Each of the eight map slots (`slots.topLeft` … `slots.bottomRight`) renders your node at the start of that slot, before the built-in entries. The status bar slots take no JSX. `slots` also has `mapOverlay` (a full-map layer), `panelFooter` (under the layers panel) and `toolbar` (unpositioned, in the map area).

```tsx
import { ElementEditor, IconButton } from '@element-editor/react'
import { Gear } from '@phosphor-icons/react'

<ElementEditor
  slots={{
    bottomLeft: (
      <IconButton label="Admin" onClick={openAdmin}>
        <Gear size={24} />
      </IconButton>
    ),
  }}
/>
```

`IconButton` is the 48×48 card all built-in map buttons use (same style, tooltip, active/hover/focus/disabled states).

---

## Floating toolbar direction

Where the toolbar sits is a layout slot. How its tools are laid out inside is `config.toolbar.direction`:

```tsx
config={{
  toolbar: { direction: 'vertical' },          // stack tools top to bottom
  ui: { layout: withLayout({ move: { toolbar: { slot: 'leftCenter', at: 'start' } } }) },
}}
```

In `vertical` mode the search input collapses to a magnifying-glass button whose popup opens beside the toolbar (away from the map edge it's on).

---

## Styling hooks

- `[data-elm-slot="bottomLeft"]` (and every other slot name) — the slot's container.
- `[data-elm-group]` — a group; `[data-elm-separator]` — a separator.
- `[data-elm-status-bar]` — the status bar.

---

## Worked example — a "viewer with admin tools" layout

Viewers see the map and the basemap picker; admins also get the table and schema editor (bottom-right, vertical); super-admins get the GeoJSON inspector and the apply button (top-right).

```tsx
import { ElementEditor, type LayoutConfig } from '@element-editor/react'

const layout: LayoutConfig = {
  topCenter: ['toolbar'],
  topLeft: ['basemap', 'fitBounds', 'zoomIndicator'],
  leftCenter: [{ group: ['undo', 'redo'] }],
  ...(role !== 'viewer' && { bottomRight: { items: [{ group: ['table', 'schema'] }], direction: 'vertical' } }),
  ...(role === 'super' && { topRight: ['geojson', 'applyChanges'] }),
  statusRight: ['attribution'],
}

<ElementEditor
  readonly={role === 'viewer'}
  config={{ ui: { layout, keyboardShortcuts: { show: false, mapZoom: true } } }}
  onSubmit={role === 'super' ? handleSave : undefined}
/>
```

---

## Adapter-only setups

`ui.layout` is for `<ElementEditor>`. With `@element-editor/adapter-leaflet` / `adapter-maplibre` and `ElementEditorUIProvider` you compose the UI yourself; put `UndoRedoToolbar` (or `UndoButton`, `RedoButton` inside a `ControlGroup`), `FloatingToolbar` and the buttons wherever you like. A standalone `FloatingToolbar` reads its position from the toolbar's layout slot (`ui.layout: { bottomRight: ['toolbar'] }`).

---

## What's next

- [Reference: ElementEditorConfig](../reference/element-editor-react.md#elementeditorconfig) — the full config type
- [Custom UI with adapters](./custom-ui-with-adapters.md) — building a fully custom layout on `@element-editor/adapter-leaflet`/`maplibre`
- [Theming](./theming.md) — recoloring the editor to match your product
