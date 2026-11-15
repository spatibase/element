import { useMemo, type ReactNode } from 'react'

// Read-only JSON highlighting with the GeoJSON inspector's token colours
// (CodeMirror defaultHighlightStyle in light, oneDark in dark) — without
// pulling CodeMirror into the sidebar bundle.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

const keyClass = 'text-gray-800 dark:text-[#e06c75]'
const stringClass = 'text-[#a11] dark:text-[#98c379]'
const numberClass = 'text-[#164] dark:text-[#d19a66]'
const boolClass = 'text-[#219] dark:text-[#d19a66]'
const nullClass = 'text-[#164] dark:text-[#d19a66]'

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of json.matchAll(TOKEN)) {
    const i = m.index
    if (i > last) out.push(json.slice(last, i))
    const [all, str, colon, bool] = m
    if (str !== undefined) {
      out.push(<span key={i} className={colon ? keyClass : stringClass}>{str}</span>)
      if (colon) out.push(colon)
    } else if (bool !== undefined) {
      out.push(<span key={i} className={boolClass}>{all}</span>)
    } else {
      out.push(<span key={i} className={all === 'null' ? nullClass : numberClass}>{all}</span>)
    }
    last = i + all.length
  }
  if (last < json.length) out.push(json.slice(last))
  return out
}

export function JsonCode({ json, className }: { json: string; className?: string }) {
  const nodes = useMemo(() => highlight(json), [json])
  return <pre className={className}>{nodes}</pre>
}
