'use client'

import dynamic from 'next/dynamic'

// ssr: false keeps the map library out of the server render (it needs the DOM).
const ElementEditor = dynamic(
  () => import('@element-editor/react').then((m) => m.ElementEditor),
  {
    ssr: false,
    loading: () => <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>Loading map...</div>,
  },
)

export default function MapEditor() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ElementEditor onChange={console.log} />
    </div>
  )
}
