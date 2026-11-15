# Keyboard shortcuts

*Draw faster. Edit faster. Don't touch the mouse more than necessary.*

Element has two categories of shortcuts: fixed shortcuts that cannot be changed, and configurable shortcuts that each user can remap to their preferred key. Shortcuts do not fire when focus is inside an input field, textarea, or any other form control.

Shortcuts are also scoped to their editor. A key acts on an editor only when focus is inside it, or when focus is on the page itself (not in another control) and your last click was inside that editor. With two editors on one page, keys go to the one you last used; your host page's own modals and inputs keep their keys, including `Escape`. A single editor on the page also responds before you've clicked it. If you add your own portaled UI (a menu or dialog attached to `body`), give its root a `data-elm-portal` attribute so the editor's shortcuts keep working while it has focus.

---

## Fixed shortcuts

These shortcuts are built into the editor and cannot be remapped:

| Shortcut | Action |
|---|---|
| `Cmd+Z` / `Ctrl+Z` | Undo |
| `Cmd+Shift+Z` / `Ctrl+Shift+Z` | Redo |
| `Cmd+A` / `Ctrl+A` | Select all features |
| `Cmd+C` / `Ctrl+C` | Copy selected features (writes a GeoJSON `FeatureCollection` to the system clipboard, so paste works across tabs) |
| `Cmd+V` / `Ctrl+V` | Paste |
| `Cmd+D` / `Ctrl+D` | Duplicate selected features |
| `Cmd+E` / `Ctrl+E` | Open edit/detail panel for the selected feature |
| `Cmd+G` / `Ctrl+G` | Group selected features into a new group |
| `Cmd+J` / `Ctrl+J` | Toggle "Return to select after each shape" (off by default: the drawing tool stays active after a shape) |
| `Cmd+O` / `Ctrl+O` | Import a GeoJSON file (replaces the data, fits the map; same as dropping a file on the map) |
| `Cmd+S` / `Ctrl+S` | Export a GeoJSON file |
| `Cmd+Shift+G` / `Ctrl+Shift+G` | Ungroup selected features |
| `Cmd+F` / `Ctrl+F` | Search / geocode (`Enter` goes to the highlighted or first result, `↑` / `↓` pick one) |
| `Delete` / `Backspace` | Delete selected features (or selected vertices in vertex edit mode) |
| `Enter` | Finish drawing (commit line / area / route) — also toggles vertex edit on a selected line or area |
| `Escape` | Cancel drawing / exit vertex edit / deselect, then close the open window (shortcuts, settings, schema); inside a window it closes that window |

---

## Opt-in shortcuts

Disabled by default. Enable via `config.ui.keyboardShortcuts.mapZoom = true`.

| Shortcut | Action |
|---|---|
| `Cmd++` / `Ctrl++` (or `Cmd+=`) | Zoom map in by one level |
| `Cmd+-` / `Ctrl+-` | Zoom map out by one level |

These intercept the browser's page-zoom shortcut, so they are off by default and only fire while the cursor is over the editor and no input is focused. Outside the editor (or while typing in any field) the browser's normal page-zoom behavior is preserved.

---

## Configurable shortcuts

These defaults can be remapped by each user. Press `K` to open the shortcuts panel and click any row to assign a new key.

| Default key | Action | Shortcut ID |
|---|---|---|
| `P` | Place point | `place-point` |
| `L` | Draw line | `draw-line` |
| `G` | Draw area | `draw-polygon` |
| `R` | Draw rectangle | `draw-rect` |
| `O` | Draw circle | `draw-circle` |
| `C` | Draw route | `draw-route` |
| `F` | Draw freehand | `draw-freehand` |
| `X` | Picker | `picker` |
| `M` | Measure | `measure` |
| `A` | Toggle transform | `toggle-transform` |
| `H` | Cut hole | `cut-hole` |
| `J` | Slice shape | `slice-shape` |
| `B` | Break apart | `break-apart` |
| `T` | Toggle data table | `toggle-table` |
| `S` | Toggle schema editor | `toggle-schema` |
| `I` | Toggle GeoJSON inspector | `toggle-geojson` |
| `/` | Toggle layers panel | `toggle-sidebar` |
| `K` | Show shortcuts panel | `show-shortcuts` |
| `Z` | Set zoom level (opens the zoom input with the number selected) | `set-zoom` |

---

## Customising shortcuts

Press `K` to open the shortcuts panel. Click any action row and press the key you want to assign. The new binding takes effect immediately.

**Conflict detection:** Element warns if you attempt to bind a key already in use by another action. You must resolve the conflict before the new binding is saved.

**Read-only mode:** with `readonly`, the shortcuts that edit (tool keys except Measure, Delete, undo/redo, duplicate, paste, group, import, vertex edit, transform) do nothing; viewing ones (select all, copy, export, measure, panels) still work.

**Tool suppression:** If `tools` (or `config.tools`) is set on the editor, keyboard shortcuts for excluded tools are suppressed automatically. A tool that isn't available in the toolbar doesn't respond to its key.

---

## Persistence

Custom bindings are saved to `localStorage` under the key `elm_shortcuts` (`elm_<persistKey>_shortcuts` with `config.persistKey`; nothing is saved with `config.persist: false`). Bindings survive page reloads and persist until the user clears their browser storage or explicitly resets shortcuts in the panel.

> **Note:** Custom bindings are per-browser, per-origin. If a user opens the editor on a different device or in a different browser profile, they start with the default bindings.
