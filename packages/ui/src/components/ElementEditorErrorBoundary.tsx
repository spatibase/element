import React from 'react'
import { ElementEditorError } from '@element-editor/core'

interface Props {
  children: React.ReactNode
  /** Gets the caught error as an `ElementEditorError` with `code: 'crash'` (the original is its `cause`). */
  onError?: (error: ElementEditorError) => unknown
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Class-based ErrorBoundary that catches render errors anywhere inside the
 * Element editor tree and shows a minimal "Try again" fallback. Originally
 * lived inside `@element-editor/react`'s `ElementEditor.tsx`; promoted to `@element-editor/ui`
 * so standalone adapter consumers (adapter-leaflet / adapter-maplibre) can
 * wrap their tree in the same safety net.
 *
 * Intentionally minimal styling (inline) so it works even if the CSS bundle
 * itself failed to load.
 */
export class ElementEditorErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(new ElementEditorError('crash', 'editor', `The editor crashed: ${error?.message ?? String(error)}`, { cause: error }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: '100%', padding: 32, fontFamily: 'var(--elm-font, system-ui, sans-serif)',
            // Design tokens when the integrator set them; the plain fallback look otherwise.
            background: 'var(--elm-surface-sunken, #fafafa)', color: 'var(--elm-text, #333)',
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Something went wrong</p>
          <p style={{ fontSize: 13, color: 'var(--elm-text-muted, #666)', marginBottom: 16, maxWidth: 420, textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred in the map editor.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '1px solid var(--elm-border, #ddd)',
              background: 'var(--elm-surface, white)', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
