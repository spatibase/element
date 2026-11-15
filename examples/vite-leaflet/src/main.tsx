import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ElementEditor } from '@element-editor/react/leaflet'
import '@element-editor/react/leaflet/style.css' // includes Leaflet's CSS

function App() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ElementEditor onChange={(data) => console.log(data)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
