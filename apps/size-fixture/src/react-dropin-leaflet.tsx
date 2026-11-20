// Reference: the drop-in component, Leaflet entry.
import { createRoot } from 'react-dom/client'
import { ElementEditor } from '@element-editor/react/leaflet'

createRoot(document.getElementById('root')!).render(<ElementEditor />)
