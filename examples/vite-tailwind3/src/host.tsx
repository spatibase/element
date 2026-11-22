// host.html: the host page without Element (only the host's CSS), the reference the smoke check
// compares the editor page's host elements against.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HostProbe } from './HostProbe'
import './index.css'

createRoot(document.getElementById('root')!).render(<StrictMode><HostProbe /></StrictMode>)
