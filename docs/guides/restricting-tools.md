# Restricting tools

*Control exactly what users can draw and do.*

Sometimes you want users to draw only polygons. Sometimes you want a read-only viewer. Sometimes you want to cap the number of features at ten. Here's how to shape the editor surface to match your use case.

---

## Restricting which drawing tools appear

Pass a `tools` array to limit the available drawing tools. Only tools in the array will appear in the toolbar, and keyboard shortcuts for excluded tools are suppressed automatically.

```tsx
// Show only the area, line and point tools
<ElementEditorControls
  tools={['polygon', 'line', 'point']}
  onChange={handleChange}
/>
```

The full set of toolbar items the editor can render:

```ts
type DrawTool =
  | 'polygon'    // the Area tool
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'point'
  | 'freehand'
  | 'route'
  | 'picker'    // import an existing shape from OpenStreetMap
  | 'measure'   // distance / area measurement
  | 'search'    // place-search input (geocoder)
```

`picker`, `measure`, and `search` aren't drawing tools per se — they're toolbar features. They live in the same union because they share the same toolbar gating; restricting `tools` is the one place to control everything that appears in the FloatingToolbar.

Turning a service off in `config.network` also hides what needs it, on top of `tools`: `routing: false` hides `route`, `nominatim: false` hides `search`, and on Leaflet `overpass: false` hides `picker` (see [Third-party services](./third-party-services.md#turning-services-off)).

Passing an empty array (`tools={[]}`) hides all toolbar items. Combined with `readonly`, this gives you a viewer with no editing surface at all.

`<ElementEditor>` takes the same list as the `tools` prop or as `config.tools` (which also accepts `'all'`); the prop wins when both are set. Anything you don't list is hidden, so list `picker`, `measure` or `search` to keep them:

```tsx
<ElementEditor tools={['polygon', 'point', 'measure', 'search']} />  // hides everything else
```

The adapters' `ElementEditorControls` take the same `tools` list.

---

## Capping the feature count

Use `maxFeatures` to limit how many features can exist at once. Once the limit is reached, the drawing tool buttons in the toolbar are greyed out and their keyboard shortcuts won't start a tool.

```tsx
<ElementEditorControls maxFeatures={10} onChange={handleChange} />
```

The store enforces the limit for every path that adds features, so the count never goes past `maxFeatures`:

- **Drawing, the OSM picker, search results, duplicate (including Alt-drag) and paste** are refused at the limit. Paste is all-or-nothing: if the whole clipboard doesn't fit, nothing is pasted.
- **Break apart and slice** are refused when the extra parts would go past the limit. Merge always works, since it never adds to the count.
- **Imports** (file, drag and drop, Cmd+O, `ref.importGeoJSON`, `initialData`) are truncated to the remaining room and return `ImportResult.truncated: true`. In `merge` mode the existing features count toward the limit; in `replace` mode they don't.
- **Undo and redo** are never blocked.

Each refusal emits an `error` event ("Maximum of 10 features reached — delete some to add more."), shown as a toast unless you handle `onEvent`. Leave `maxFeatures` unset for no limit.

### Single-feature fields

For a field that holds one shape, such as "pick the location", add `replaceAtLimit` to `maxFeatures={1}`. Drawing at the limit then replaces the existing feature's geometry instead of being refused:

```tsx
<ElementEditor tools={['point']} maxFeatures={1} replaceAtLimit onChange={setLocation} />
```

- **Every drawing tool** (point, line, area, rectangle, circle, freehand, route and the OSM picker) replaces the only feature when one exists, and stays available in the toolbar and by shortcut. With no feature yet, a draw adds one as usual.
- The feature keeps its `id`, properties, schema and group. `_drawType` and a route's waypoints follow the new shape: drawing a circle over a polygon tags it a circle, drawing a plain polygon over a circle drops the tag.
- It is one undo step (undo restores the old geometry), one `onChange`, and one `onFeatureUpdate` (not add or delete). The feature stays selected.
- **Search results** (adding a place or its outline from the search box) replace the feature too.
- **Paste, duplicate (Cmd+D), the context menu's Center point, import in `merge` mode and `ref.addFeature` are still refused** with the usual `limit-reached` error; `ref.importGeoJSON` in `replace` mode and `setFeatureCollection` are unchanged.
- `replaceAtLimit` only takes effect with `maxFeatures={1}`. With any other limit it is ignored (a development warning says so).

---

## Allowed geometry types

`tools` only decides which drawing tools the toolbar offers. `geometryTypes` goes further: it lists the GeoJSON geometry types the editor may hold, and the store enforces it for every way a geometry gets in. Use it when your backend stores only some shapes, for example only points, or only polygons.

```tsx
<ElementEditor geometryTypes={['Polygon', 'MultiPolygon']} />
```

The values are GeoJSON type names: `'Point'`, `'MultiPoint'`, `'LineString'`, `'MultiLineString'`, `'Polygon'`, `'MultiPolygon'` and `'GeometryCollection'`. Leave the prop unset to allow all of them. `GeometryCollection` is checked as a whole: its members aren't looked at separately.

What changes when the prop is set:

- **Tools.** A tool is offered only if it can draw an allowed type: Point needs `'Point'`; Line and Route need `'LineString'`; Area, Circle and Rectangle need `'Polygon'`; Freehand needs `'LineString'` or `'Polygon'`; the OSM Picker needs `'Polygon'` or `'MultiPolygon'`. The others leave the toolbar, their keyboard shortcuts do nothing and `ref.setTool` returns `false`. This stacks with `tools` (a tool must pass both). Measure and search are not affected.
- **Menus.** Actions whose result would be refused are hidden: Merge (two points become a MultiPoint, mixed shapes a GeometryCollection), Break apart (it needs the part type), Slice (Polygons), Buffer and Cut hole (a Polygon or MultiPolygon), Center point (a Point), and the data table's "Add new" (a Point).
- **Everything else is refused in the store.** Paste, search results, the OSM picker, the ref API (`addFeature`, `updateFeature`, `updateFeatures`), edits in the GeoJSON inspector, boolean operations and the buffer, cut and slice tools whose result has a type that isn't allowed (the result of Subtract can be a MultiPolygon, for example). A refused operation is all-or-nothing: nothing is written and no undo step is added. Changing a feature's geometry without changing its type (dragging, editing points) is never refused.
- **Imports** (file, drag and drop, Cmd+O, `ref.importGeoJSON`, `ref.setFeatureCollection`, `initialData`) skip the features with a type that isn't allowed and load the rest. `ImportResult.refused` counts them, and one `error` event says how many were skipped. Refused features don't count against `maxFeatures`.

Each refusal emits an `error` event with `code: 'geometry-type-not-allowed'` ("Polygon isn't allowed here: this editor accepts only Point."), shown as a toast unless you handle `onEvent` or `onError` (see [Events](../reference/events.md#onerror)).

Data that is already in the editor when the prop changes stays as it is; only new changes are checked.

---

## Disabling all editing

The `readonly` prop turns off every way a user can change the data. Features remain visible and selectable — users can click features to see their properties, and selection highlighting still works.

What stays available in `readonly`:

- Selecting features (map, layers list, data table rows), zooming to them, and the details panel (fields shown disabled).
- Showing / hiding features and groups, collapsing groups (view state, not data).
- Measuring, search (fly to a result, without the Add buttons), copy (Cmd+C), export (Cmd+S, Download), the data table, the GeoJSON inspector (read-only text) and the layout panels.

What is turned off:

- Drawing tools, the picker, vertex editing, transform, drag-to-move, cut hole / slice / buffer / simplify / smooth, boolean ops, merge / break apart.
- Deleting, duplicating, pasting, grouping / ungrouping, renaming features, groups or schemas, drag-reordering the layers list.
- Data table cell edits, paste into cells, row delete and "Add new"; the schema editor (button and shortcut); typing in the GeoJSON inspector.
- Importing (Cmd+O, dropping a file on the map) and undo / redo (buttons hidden, Cmd+Z / Cmd+Shift+Z ignored): nothing the user could undo was done by them.

The ref API is not restricted: the host app can still change data in `readonly` (only `setTool` is refused).

```tsx
<ElementEditorControls readonly initialData={savedData} />
```

`readonly` is a good fit for display contexts where you want users to explore data without being able to change it.

---

## Combining restrictions

For a fully locked viewer with no editing affordances:

```tsx
<ElementEditorControls
  readonly
  initialData={savedData}
  tools={[]}
/>
```

The `tools={[]}` is belt-and-suspenders here — `readonly` already disables all drawing. But it also removes the toolbar entirely, for a cleaner viewer UI.

For a controlled drawing experience where users can place exactly one point:

```tsx
<ElementEditorControls
  tools={['point']}
  maxFeatures={1}
  onChange={handleChange}
/>
```

Once the user places a point, the tool is disabled. They can still move and delete the point; drawing a second one is blocked. To let them place a new point instead (moving the existing one), add `replaceAtLimit`, see [Single-feature fields](#single-feature-fields).

---

## Hiding UI panels and buttons

The `config` prop exposes granular visibility toggles for every editor panel and button. All default to `true`.

```tsx
<ElementEditor
  config={{
    ui: {
      hints: false,           // Remove drawing action hints from the active toolbar
      dataTable: false,       // Hide the data table panel and button
      layerList: false,       // Hide the layers/features list panel
      schemaEditor: false,    // Hide the schema editor button
      geojsonEditor: false,   // Hide the GeoJSON editor button
      settings: false,        // Hide the map settings button
      zoomToAll: false,       // Hide the "fit all features" zoom button
      zoomIndicator: false,   // Hide the zoom level indicator
      locateButton: false,    // Hide the "show my location" button
      keyboardShortcuts: false, // Disable shortcuts and hide the shortcuts button
    },
  }}
/>
```

For finer control over keyboard shortcuts:

```tsx
// Keep shortcuts active but hide the shortcuts reference button
config={{ ui: { keyboardShortcuts: { enabled: true, show: false } } }}
```

These flags can be combined freely with the flat `tools`, `readonly`, `maxFeatures`, and `geometryTypes` props.

---

## What's next

- [Reference: @element-editor/react](../reference/element-editor-react.md) — full `ElementEditorProps` table
- [Reference: adapter-leaflet](../reference/adapter-leaflet.md) — `ElementEditorControlsProps`
- [Reference: adapter-maplibre](../reference/adapter-maplibre.md) — `ElementEditorControlsProps`
