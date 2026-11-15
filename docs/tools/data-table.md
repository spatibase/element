# Data table

*A spreadsheet view of all your features and their properties.*

The data table is one of Element's key differentiators. It presents all features as rows in a sortable, filterable, inline-editable grid, with live two-way synchronisation to the map. Changes made in the table update the feature on the map immediately, and selecting a feature on the map highlights its row in the table.

---

## Opening the table

- Press `T` (default key, configurable)
- Click the table icon in the bottom toolbar

The table opens as a resizable panel. Drag the panel divider to give the table more or less screen space. It slides open and closed in step with the toolbars and slots above it.

---

## Columns

Each row is one feature. Which property columns show depends on the table's schema filter: with more than one schema, the table toolbar has a tab per schema plus **All**. A schema's tab lists only the features that use that schema, with that schema's fields as columns; **All** (the default) lists every feature, with the fields of every schema (a field key shared by several schemas is one column). The columns are, in order:

- A checkbox column for selecting rows (bulk delete).
- **Type**: the shape's type in plain words with its icon (Point, Points, Line, Lines, Area, Areas, Mixed) and its size ("4 points", "2 parts · 9 points").
- **Schema**: the feature's schema, editable, only when there is more than one schema.
- **Lat** and **Lng**: only while the table lists at least one `Point`, and editable only on points (other shapes leave them empty).
- The schema fields, in definition order.

Properties that no schema defines have no column; they stay on the feature (the GeoJSON inspector shows them). Add fields to a schema to create editable columns — see the Schema editor (`S` key).

---

## Inline editing

Click any cell to open an inline editor for that property. The editor follows the field type defined in the schema: a select field shows a dropdown, number, date and URL fields the matching input, and text and textarea fields a plain text input.

A boolean field shows a toggle in every row, like the one in the feature panel. Click the toggle, or select the cell and press `Space` (or `Enter`), to switch it on or off. Each switch is one undo step, and the value is stored as `true` or `false`. Values imported as text or numbers (`"yes"`, `"true"`, `1`) show as on and are stored as booleans once switched.

Changes are committed immediately when you tab out or click elsewhere. The updated value is reflected in the feature's `properties` on the next `onChange` event.

### Pasting

Select an editable cell and paste (`Cmd/Ctrl+V`) text from the clipboard. If the text is a spreadsheet copy, the first cell is used (first line, first tab-separated value). Into a boolean field, `true` / `yes` / `1` / `on` / `x` switch it on and `false` / `no` / `0` / `off` switch it off (any case). Values that don't fit the column (a non-numeric latitude, longitude or number field, an unknown select option or schema name, any other text in a boolean field) are ignored and the cell keeps its value.

---

## Row and map synchronisation

The table and the map stay in sync at all times:

- **Checking a single row** selects the corresponding feature on the map and brings it into view: the map centres on a point and fits any other shape.
- **Selecting a feature on the map** highlights the corresponding row in the table.

This synchronisation makes it straightforward to cross-reference what you see on the map with the underlying data.

---

## Column sorting

Click any column header to sort all rows by that column; an arrow in the header shows the direction. Click the same header again to reverse the sort order. Boolean columns sort off before on. Sorting is applied to the visible rows only and does not change the feature collection order.

---

## Filtering

The schema tabs filter the rows (see [Columns](#columns)). Layer visibility doesn't: features hidden with the eye toggle in the Layers panel still have a row in the table, so you can edit their data while they're off the map.

---

## Export

The export actions (Layers panel, GeoJSON inspector) export **all features regardless of the table's schema filter** and of layer visibility. The filter affects the table display only — it is not a data filter.
