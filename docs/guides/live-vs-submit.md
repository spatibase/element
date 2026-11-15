# Live mode vs submit mode

*When to listen to every edit, when to wait for a Save click.*

`<ElementEditor>` doesn't decide when to persist your data — you do. There are two patterns, picked by which callbacks you wire up. This page walks through both with concrete code, network shapes, and the trade-offs.

---

## The short version

| | Live mode | Submit mode |
|---|---|---|
| **Wired prop** | `onChange` | `onSubmit` (+ optional `onChange`) |
| **When data goes to your backend** | When *you* decide (per change, debounced, manual save button…) | When the user clicks **Apply changes** |
| **Validation** | You run it yourself | Built-in: gates the submit |
| **Network frequency** | Up to you (often: many small PATCHes) | Exactly one POST per submit |
| **UX message** | "Edits are auto-saved" | "Drafting until you confirm" |
| **Best for** | Internal tools, dashboards, real-time collaboration, Notion-likes | Public forms, listings, admin "save zone" flows, multi-step wizards |

---

## Live mode — `onChange` only

You provide an `onChange` callback. Element fires it with the current `FeatureCollection` after every committed edit (drawing, dragging, deleting, property change). What you do with the data is entirely your call.

```tsx
import { ElementEditor, type FeatureCollection } from '@element-editor/react'
import { useDebouncedCallback } from 'use-debounce'

export function ZoneEditor({ zones }: { zones: FeatureCollection | null }) { // e.g. loaded from your API
  // Save debounced — one network call per second of inactivity
  const debouncedSave = useDebouncedCallback((data: FeatureCollection) => {
    fetch('/api/zones', { method: 'PUT', body: JSON.stringify(data) })
  }, 1000)

  // initialData is the starting data (applied once, also if `zones` arrives after mount); the editor owns the data after that
  return <ElementEditor initialData={zones} onChange={debouncedSave} />
}
```

**Variations on the same pattern:**
- Save on every change (no debounce) — chatty but simple
- Buffer in component state, flush manually with your own button — custom save UX
- Push over WebSocket for real-time collaboration
- Write to `localStorage` for offline-first apps (see [Persisting data](./persisting-data.md))

**No Apply changes button.** The editor is "live" — the canvas *is* the saved state.

---

## Submit mode — `onSubmit` provided

You provide an `onSubmit` callback. Element renders an **Apply changes** primary button (last in the bottom-left controls by default; it's the `'applyChanges'` layout entry). The user can edit freely — nothing leaves the editor — until they click the button.

```tsx
import { ElementEditor, type Schema } from '@element-editor/react'
import { toast } from 'sonner'
import { useRouter } from 'next/router'

const zoneSchema: Schema = {
  id: 'zone',
  name: 'Delivery zone',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'fee',  label: 'Delivery fee ($)', type: 'number', required: true },
  ],
}

export function NewZonePage() {
  const router = useRouter()

  return (
    <ElementEditor
      schema={zoneSchema}
      onSubmit={async (data) => {
        await fetch('/api/zones', { method: 'POST', body: JSON.stringify(data) })
        router.push('/zones')
      }}
      onValidationError={(errors) => {
        const count = Object.keys(errors).length
        // `toast` is your app's own sonner instance: render your own <Toaster /> for it.
        // ElementEditor's built-in <Toaster> only shows the editor's own toasts.
        toast.error(`${count} feature${count > 1 ? 's' : ''} have validation errors`)
      }}
    />
  )
}
```

**What happens when the user clicks Apply changes:**
1. Element runs schema validation against every feature.
2. If any feature has errors → fires `onValidationError({ [featureId]: ['error msg', …] })` and **does not submit**.
3. If clean → fires `onSubmit(data)` exactly once with the cleaned `FeatureCollection`.

The button only renders when `onSubmit` is provided. Removing the prop removes the button — same component, different mode.

You can also fire the same flow imperatively:

```tsx
const ref = useRef<ElementEditorRef>(null)
// later
ref.current?.submit()
```

`submit()` returns `true` if `onSubmit` fired and `false` if validation blocked it.

---

## Combining both

You can wire both. `onChange` fires continuously (e.g. for live previews elsewhere in your UI); `onSubmit` is the explicit "save" moment.

```tsx
<ElementEditor
  schema={zoneSchema}
  onChange={(data) => setLivePreview(data)}     // sidebar count, live map elsewhere, etc.
  onSubmit={(data) => persistToBackend(data)}   // the explicit save
/>
```

Useful when you want a side panel showing "5 zones drawn (3 unsaved)" or a real-time mini-map elsewhere on the page.

---

## Backend shape implications

**Live mode** typically maps to:
- `PUT /api/resource` to overwrite a single resource on every (debounced) change
- `PATCH` for delta-style sync
- WebSocket frames for real-time collaboration
- IndexedDB / localStorage for offline-first

**Submit mode** typically maps to:
- One `POST /api/resource` per click — clean transaction
- Form-multipart submission alongside other inputs (zone name, photo upload, etc.)
- Wizard step commits

Neither pattern is "better" — they describe different products. A weather-monitoring dashboard wants live mode; a delivery-zone admin tool wants submit.

---

## Related props

- [`onValidationError`](../reference/events.md#onvalidationerror) — fires when submit-mode validation blocks
- [`onFeatureSelect`](../reference/events.md#onfeatureselect) — independent of mode; fires whenever the user clicks a feature
- [`onEvent`](../reference/events.md#onevent) — every message the editor would show as a toast (errors, warnings, confirmations, undo); providing it silences the built-in toasts
- [`config.ui.layout`](./configuring-layout.md) — control where the **Apply changes** button (`'applyChanges'`) lives (default: end of `bottomLeft`)

---

## What's next

- [Persisting data](./persisting-data.md) — concrete examples for localStorage, REST APIs, and databases
- [Schema and validation](./schema-and-validation.md) — define the field rules that gate submit-mode
- [Reference: events](../reference/events.md) — every callback, when it fires, and the firing order
