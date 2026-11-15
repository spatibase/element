# @element-editor/ui: guide for coding agents

The React UI of the Element map editor, engine-neutral: toolbars, layers panel, data table, schema editor, GeoJSON inspector, settings and shortcut dialogs, plus the providers and store hooks they need. It has no map of its own.

You need it only with an adapter (`@element-editor/adapter-maplibre` or `@element-editor/adapter-leaflet`) on a map you own, to place the editor UI yourself. The drop-in `@element-editor/react` already renders all of it; don't combine the two. Start from `node_modules/@element-editor/react/AGENTS.md` (when installed) or https://elementeditor.dev/docs/introduction/choosing-a-package.

## Install and CSS

```bash
pnpm add @element-editor/ui @element-editor/adapter-maplibre maplibre-gl            # MapLibre
pnpm add @element-editor/ui @element-editor/adapter-leaflet leaflet react-leaflet    # or Leaflet
```

Peers: `react`, `react-dom` `^19.2.0`. This package has no stylesheet of its own: import the adapter's (`@element-editor/adapter-maplibre/style.css` plus `maplibre-gl/dist/maplibre-gl.css`, or `@element-editor/adapter-leaflet/style.css`). Keep all `@element-editor/*` packages on one version. On MapLibre GL JS 6 (what `maplibre-gl` installs today) your app must call MapLibre's `setWorkerUrl` before creating the map: see the MapLibre adapter's `AGENTS.md`.

## Entries

| Entry | What | Semver |
|---|---|---|
| `@element-editor/ui` | components, providers, hooks, `ElementEditorImperativeAPI`, `MutationOptions`, `ElementEditorConfig`, `DEFAULT_LAYOUT`, `withLayout` | yes |
| `@element-editor/ui/primitives` | `Button`, `Input`, `Textarea`, `SelectInput`, `Tooltip`, `Kbd`, `ToolButton`, `ContextMenu`, `SearchDropdown`, `EditToolbarBtn` (no store needed) | yes |
| `@element-editor/ui/internal` | plumbing shared by the Element packages | **no**: don't import |

## Provider stack

| Layer | Required | Notes |
|---|---|---|
| `ElementEditorUIProvider` | yes | error boundary, `config`, shortcuts, events + its own toaster, map controller. Props: `config`, `accentColor`, `featureColor`, `onEvent`, `onError`, `toaster` (default `true`) |
| `GeoStoreProvider` | yes | the store shared by the adapter and these components; one per editor |
| `ThemeContext.Provider value="light" \| "dark"` | for dark mode | portaled menus and modals read it |
| `<div data-elm-theme="light">` | yes | scopes styles and keyboard shortcuts; contains the map and all UI |

`ElementEditorUIProvider` and `GeoStoreProvider` are also exported by both adapters (same components); `ThemeContext` comes from here. Full examples (MapLibre: UI as `children` of `ElementEditorControls`; Leaflet: UI as siblings of `MapContainer`) are in each adapter's `AGENTS.md`.

## Your own UI on the store

Any component under `GeoStoreProvider` can read and change editor state:

```tsx
import { useDataStore, useUIStore } from '@element-editor/ui'

export function StatusChip() {
  const count = useDataStore((s) => s.features.length)
  const selected = useDataStore((s) => s.selectedIds.length)
  const toggleTable = useUIStore((s) => s.toggleTable)
  return (
    <button onClick={toggleTable}>
      {count} features, {selected} selected
    </button>
  )
}
```

For data changes prefer the adapter's ref (`ElementEditorControlsRef`: `addFeature`, `updateFeature`, `setFeatureCollection`, …), which fires `onChange` and the other callbacks like a user edit.

## Gotchas

- `DataTablePanel`, `SchemaModal`, `GeoJSONModal`, `SettingsModal`, `ShortcutsModal` and `BooleanOperations` are lazy: wrap each in its own `<Suspense>` (a shared boundary unmounts loaded siblings while another loads).
- `SchemaModal` and `GeoJSONModal` render whenever mounted: mount them only while `useUIStore((s) => s.schemaModalOpen)` / `codeModalOpen` is true and pass `onClose={toggleSchemaModal}` / `toggleCodeModal`.
- UI you portal outside the `data-elm-theme` element needs a `data-elm-portal` attribute, or it is unstyled and shortcuts stop while it has focus.
- `onEvent` on the provider silences every built-in toast; use `onError` (returns `void | false | string`) for logging or translated messages.
- Several editors on one origin: give each `config={{ persistKey: '…' }}` so their localStorage keys don't collide.
- `Button` joins `className` with `clsx` (no tailwind-merge), so it can't reliably override the variant's own classes (hover, transition); use your own element for different looks.

Docs: https://elementeditor.dev/docs/guides/custom-ui-with-adapters, https://elementeditor.dev/docs/reference/element-editor-ui, https://elementeditor.dev/docs/reference/events. Markdown: append `.md`; everything at once: https://elementeditor.dev/llms-full.txt.
