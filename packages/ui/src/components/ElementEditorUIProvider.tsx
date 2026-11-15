import { useMemo, type ReactNode } from 'react'
import { ElementEditorConfigProvider, type ElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { ShortcutConfigProvider } from '../contexts/ShortcutConfigContext'
import { EventProvider } from '../contexts/EventContext'
import { MapControllerProvider } from '../contexts/MapControllerContext'
import { ThemeReportingProvider } from '../contexts/ThemeContext'
import { ElementEditorErrorBoundary } from './ElementEditorErrorBoundary'
import type { ElementEditorEvent, ElementEditorErrorHandler } from '../types/events'

export interface ElementEditorUIProviderProps {
  /** Structured configuration: theme, toolbar position/direction, UI visibility, units. */
  config?: ElementEditorConfig
  /**
   * Brand accent: any CSS colour. Wins over `config.accentColor`. The whole
   * primary scale is derived from it. This provider renders no DOM, so
   * `<ElementEditorControls>` writes it as `--elm-accent` onto your themed root
   * (the nearest `[data-elm-theme]` ancestor of the map container); Element's
   * portals get it too. Updates live. Default: blue.
   */
  accentColor?: string
  /**
   * Default colour of every feature (polygon outline + fill, line, point): any CSS colour.
   * Wins over `config.featureColor`; `getFeatureStyle` and the selected look win over it,
   * hover keeps it. Opacity and weight keep their defaults. Default: slate `#475569`.
   */
  featureColor?: string
  /** Intercept all Element events. When provided, built-in sonner toasts are suppressed. */
  onEvent?: (event: ElementEditorEvent) => void
  /**
   * Called first for every runtime failure with an `ElementEditorError` (`code`, `source`,
   * honest English `message`), including a render crash (`code: 'crash'`, the original error is
   * its `cause`). Return `false` to stop the built-in toast / `onEvent` error event, or a string to
   * show that text instead. See {@link ElementEditorErrorHandler}.
   */
  onError?: ElementEditorErrorHandler
  /**
   * Render Element's own sonner `<Toaster>` (default true). Its toasts carry a
   * per-instance id, so a host `<Toaster>` or a second editor never shows them
   * twice. Pass false to send toasts to your own untagged `<Toaster>` instead.
   */
  toaster?: boolean
  children: ReactNode
}

/**
 * Provides all Element UI context needed to render FloatingToolbar, EditingToolbar,
 * and other UI components around an adapter's (Leaflet or MapLibre) ElementEditorControls.
 * Engine-neutral: both `@element-editor/adapter-leaflet` and `adapter-maplibre` re-export it.
 *
 * Wrap your app (or the relevant section) with this provider, then place
 * GeoStoreProvider + your map + ElementEditorControls inside your map component.
 *
 * Includes (in order): ElementEditorErrorBoundary, ElementEditorConfigProvider,
 * ShortcutConfigProvider, EventProvider, MapControllerProvider. Matches the
 * full context stack the `@element-editor/react` wrapper sets up.
 */
export function ElementEditorUIProvider({ config, accentColor, featureColor, onEvent, onError, toaster = true, children }: ElementEditorUIProviderProps) {
  const mergedConfig = useMemo(
    () => (accentColor || featureColor
      ? { ...config, ...(accentColor && { accentColor }), ...(featureColor && { featureColor }) }
      : config),
    [config, accentColor, featureColor],
  )
  return (
    <ElementEditorErrorBoundary onError={onError}>
      <ElementEditorConfigProvider config={mergedConfig}>
        <ShortcutConfigProvider>
          {/* Theme comes from the host's [data-elm-theme] root, reported by ElementEditorControls. Above EventProvider so its toaster can invert against it. */}
          <ThemeReportingProvider>
            <EventProvider onEvent={onEvent} onError={onError} toaster={toaster}>
              <MapControllerProvider>
                {children}
              </MapControllerProvider>
            </EventProvider>
          </ThemeReportingProvider>
        </ShortcutConfigProvider>
      </ElementEditorConfigProvider>
    </ElementEditorErrorBoundary>
  )
}
