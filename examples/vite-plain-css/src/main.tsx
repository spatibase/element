import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ElementEditor } from '@element-editor/react'
import { HostProbe } from './HostProbe'
// The host's own utilities load BEFORE Element's stylesheet.
import './host.css'
import '@element-editor/react/style.css'
import './app.css'

function App() {
  return (
    <>
      <HostProbe />
      <div style={{ width: '100%', height: '100vh' }}>
        <ElementEditor onChange={(data) => console.log(data)} />
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
