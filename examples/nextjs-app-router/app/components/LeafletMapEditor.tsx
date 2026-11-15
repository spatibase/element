'use client'

import dynamic from 'next/dynamic'

// Leaflet touches `window` as soon as it is imported, so ssr: false is required here.
const ElementEditor = dynamic(
  () => import('@element-editor/react/leaflet').then((m) => m.ElementEditor),
  { ssr: false },
)

export default function LeafletMapEditor() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
