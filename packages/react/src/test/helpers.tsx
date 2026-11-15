import { StoreContext, MapControllerProvider, EventProvider, ShortcutConfigProvider } from '@element-editor/ui'
import { createDataStore, createUIStore } from '@element-editor/core'
import { DEFAULT_SCHEMAS } from '@element-editor/core/internal'
import { render, type RenderOptions } from '@testing-library/react'
import type { GeoJSONFeature } from '@element-editor/core'

export let testDataStore = createDataStore()
export let testUIStore = createUIStore(testDataStore)

/** Wrap with all required React providers */
export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, {
    wrapper: ({ children }) => (
      <StoreContext.Provider value={{ dataStore: testDataStore, uiStore: testUIStore }}>
        <EventProvider>
          <ShortcutConfigProvider>
            <MapControllerProvider>{children}</MapControllerProvider>
          </ShortcutConfigProvider>
        </EventProvider>
      </StoreContext.Provider>
    ),
    ...options,
  })
}

/** Reset both stores to initial state before each test */
export function resetStores() {
  testDataStore = createDataStore()
  testUIStore = createUIStore(testDataStore)
  testDataStore.setState({
    features: [],
    schemas: [...DEFAULT_SCHEMAS],
    selectedIds: [],
    lastModifiedAt: null,
  })
  testUIStore.setState({
    editingMode: 'none',
    lineInProgress: [],
    dialogState: { type: 'closed' },
  })
}

/** Build a minimal Point feature for test use */
export function makePoint(overrides?: Partial<GeoJSONFeature>): GeoJSONFeature {
  return {
    type: 'Feature',
    id: 'test-point-1',
    geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
    properties: { name: 'Paris' },
    ...overrides,
  }
}

/** Build a minimal LineString feature for test use */
export function makeLine(overrides?: Partial<GeoJSONFeature>): GeoJSONFeature {
  return {
    type: 'Feature',
    id: 'test-line-1',
    geometry: { type: 'LineString', coordinates: [[2.17, 41.38], [2.19, 41.40]] },
    properties: { name: 'Test route' },
    ...overrides,
  }
}
