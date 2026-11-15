#!/usr/bin/env node
// CI helper: `node scripts/assert-maplibre-version.mjs <major>` fails unless the MapLibre packages
// resolve maplibre-gl at that major version (the maplibre-gl 5 job swaps it in after install).
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const major = process.argv[2]
let ok = true
for (const p of ['adapter-maplibre', 'react']) {
  const { version } = JSON.parse(readFileSync(join(root, 'packages', p, 'node_modules/maplibre-gl/package.json'), 'utf8'))
  console.log(`@element-editor/${p}: maplibre-gl ${version}`)
  if (major && !version.startsWith(`${major}.`)) ok = false
}
if (!ok) { console.error(`expected maplibre-gl ${major}.x`); process.exit(1) }
