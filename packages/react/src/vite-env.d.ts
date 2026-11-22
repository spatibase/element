/// <reference types="vite/client" />

/** Dev page only (aliased in vite.config.ts): maplibre-gl 6's worker file URL, or '' on maplibre-gl 5. */
declare module 'dev:maplibre-worker-url' {
  const url: string
  export default url
}
