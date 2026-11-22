import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// host.html is the same host markup without Element (see src/HostProbe.tsx).
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', host: 'host.html' } } },
})
