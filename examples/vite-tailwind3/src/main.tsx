import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ElementEditor } from '@element-editor/react'
import { HostProbe } from './HostProbe'
// The host's own CSS (Tailwind v3: unlayered utilities) loads BEFORE Element's.
import './index.css'
import '@element-editor/react/style.css'
// The other entries' stylesheets build in a Tailwind v3 host too.
import '@element-editor/react/leaflet/style.css'
import '@element-editor/adapter-leaflet/style.css'
import '@element-editor/adapter-maplibre/style.css'

function App() {
  return (
    <>
      <HostProbe />
      <div className="h-screen w-full">
        <ElementEditor onChange={(data) => console.log(data)} />
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
