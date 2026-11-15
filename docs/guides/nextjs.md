# Using Element with Next.js

*Render the editor client-only.*

The map libraries (MapLibre GL JS, which `@element-editor/react` uses, and Leaflet, which `@element-editor/react/leaflet` and `@element-editor/adapter-leaflet` use) need the browser: they create a map in a DOM element, and Leaflet also touches `window` while it is imported. Next.js runs your code on Node.js during server-side rendering, which has no `window` or DOM. The editor creates its map in an effect, so there is nothing meaningful to server-render:

- **`@element-editor/react` (MapLibre):** a server render doesn't throw. It outputs the editor's empty loading shell, and the map appears once the page hydrates in the browser. Use `ssr: false` anyway: it keeps MapLibre and the editor out of the server bundle and skips work the server can't use.
- **`@element-editor/react/leaflet` and `@element-editor/adapter-leaflet`:** `ssr: false` is required. Leaflet reads `window` as soon as it is imported, so even importing these modules on the server fails.

The pattern is a dynamic import with `ssr: false`, which loads the library only in the browser, where `window` exists. Use it for every entry point (`@element-editor/react`, `@element-editor/react/leaflet`, `@element-editor/adapter-*`).

> **Note:** `@element-editor/adapter-maplibre` and `@element-editor/adapter-leaflet` need the same treatment.

Both `@element-editor/react` entries, `@element-editor/ui` and both adapters start with a `'use client'` directive, so importing them from a Server Component no longer throws. That only marks the client boundary: Next.js still server-renders client components, so keep the `ssr: false` pattern below.

No other Next.js configuration is needed. The packages ship ES modules (`.es.js`) plus CommonJS builds (`.cjs`), their type declarations reference each other by package name, and the geometry worker is inlined, so you don't need `transpilePackages` or any worker or webpack setup. `@element-editor/react` installs `@element-editor/core`, `@element-editor/ui` and `@element-editor/adapter-maplibre` as regular dependencies; install `maplibre-gl` yourself (not needed for `@element-editor/react/leaflet`). Element requires React 19.2 or newer and works with **Next.js 15 and 16** (App Router or Pages Router). For TypeScript with a Leaflet entry, also `npm install -D @types/leaflet`. The data table's `react-data-grid` is pinned to `7.0.0-beta.57` because later betas use `useEffectEvent`, which Next.js 15's bundled React canary lacks (the build fails with `'useEffectEvent' is not exported from 'react'`). Don't override that version while you support Next.js 15. A working App Router setup with both entries is in [`examples/nextjs-app-router`](../../examples/nextjs-app-router).

### Next.js 15: upgrade React to 19.2

`create-next-app` for Next.js 15 pins `react` and `react-dom` to 19.1, below Element's `^19.2` peer range, so `npm install @element-editor/react` stops with a peer dependency conflict (`ERESOLVE`; pnpm and yarn only warn, and the editor may then break at runtime). Upgrade React in the same step:

```bash
npm install @element-editor/react maplibre-gl react@^19.2 react-dom@^19.2
```

Next.js 16 apps already use React 19.2. If your site sends a Content Security Policy, see [CSP](./third-party-services.md#content-security-policy-csp) for what the editor needs.

---

## App Router pattern

Mark the wrapper component as a client component and use `dynamic()` to load the editor only in the browser:

```tsx
// app/components/MapEditor.tsx
'use client'

import dynamic from 'next/dynamic'

const ElementEditor = dynamic(
  () => import('@element-editor/react').then((m) => m.ElementEditor),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading map...
      </div>
    ),
  }
)

export default function MapEditor() {
  return (
    <div style={{ width: '100%', height: 600 }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
```

Then use it in any Server Component page — the `'use client'` wrapper handles the client boundary. (`dynamic()` with `ssr: false` is only allowed in Client Components, which is why it lives in the wrapper and not in the page.)

```tsx
// app/page.tsx
import MapEditor from './components/MapEditor'

export default function Page() {
  return (
    <main>
      <h1>My map</h1>
      <MapEditor />
    </main>
  )
}
```

**CSS import:** Put the stylesheet import in your root layout, not inside the dynamically loaded component. It styles only the editor: Element's base styles are scoped to the editor root, so your layout's headings and buttons keep their own styles.

```tsx
// app/layout.tsx
import '@element-editor/react/style.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

---

## Pages Router pattern

```tsx
// pages/index.tsx
import dynamic from 'next/dynamic'

const ElementEditor = dynamic(
  () => import('@element-editor/react').then((m) => m.ElementEditor),
  { ssr: false }
)

export default function Home() {
  return (
    <div style={{ width: '100%', height: 600 }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
```

CSS import goes in `pages/_app.tsx`:

```tsx
// pages/_app.tsx
import '@element-editor/react/style.css'
import type { AppProps } from 'next/app'

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
```

---

## Leaflet drop-in

For `@element-editor/react/leaflet`, change the import path and the stylesheet (`@element-editor/react/leaflet/style.css`), and install its optional peers (`@element-editor/adapter-leaflet leaflet react-leaflet`). Everything else, including `ssr: false`, is the same.

```tsx
const ElementEditor = dynamic(
  () => import('@element-editor/react/leaflet').then((m) => m.ElementEditor),
  { ssr: false },
)
```

---

## Same pattern for adapters

If you're using `@element-editor/adapter-leaflet`, wrap your entire map component (the one that imports Leaflet) in a dynamic import — not just `ElementEditorControls`:

```tsx
// app/components/MyLeafletMap.tsx
'use client'

// This file imports leaflet and react-leaflet — both access window
import { MapContainer, TileLayer } from 'react-leaflet'
import { ElementEditorUIProvider, GeoStoreProvider, ElementEditorControls } from '@element-editor/adapter-leaflet'

export default function MyLeafletMap() {
  return (
    <ElementEditorUIProvider>
      <GeoStoreProvider>
        <div data-elm-theme="light" style={{ width: '100%', height: 600 }}>
          <MapContainer center={[48.86, 2.35]} zoom={5} style={{ width: '100%', height: '100%' }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ElementEditorControls onChange={console.log} />
          </MapContainer>
        </div>
      </GeoStoreProvider>
    </ElementEditorUIProvider>
  )
}
```

```tsx
// app/components/MapEditor.tsx
'use client'

import dynamic from 'next/dynamic'

const MyLeafletMap = dynamic(
  () => import('./MyLeafletMap'),
  { ssr: false }
)

export default function MapEditor() {
  return <MyLeafletMap />
}
```

Render `<MapEditor />` from your page, and import `@element-editor/adapter-leaflet/style.css` (it includes Leaflet's CSS) in `app/layout.tsx`.

The same approach applies to `@element-editor/adapter-maplibre` — wrap the component that instantiates `maplibregl.Map` in a `dynamic()` call with `ssr: false`, and import both `maplibre-gl/dist/maplibre-gl.css` and `@element-editor/adapter-maplibre/style.css`.

---

## What's next

- [Quick start: @element-editor/react](../quickstart/react.md)
- [Basemaps](./basemaps.md)
- [Quick start: Leaflet adapter](../quickstart/adapter-leaflet.md)
- [Quick start: MapLibre adapter](../quickstart/adapter-maplibre.md)
