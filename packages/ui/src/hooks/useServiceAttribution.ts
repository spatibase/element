import { useMemo } from 'react'
import { type NetworkConfig, type RoutingConfig } from '@element-editor/core'
import { routingAttribution, warnOnce } from '@element-editor/core/internal'
import { useElementEditorConfig } from '../contexts/ElementEditorConfigContext'
import { useUIStore } from '../store/StoreContext'
import { NOMINATIM_ATTRIBUTION, NOMINATIM_URL } from './useNominatim'

/** Credits for the services in use: the geocoder while search is offered, the router while the Route tool is. */
export function serviceAttribution(network: NetworkConfig, on: { search: boolean; route: boolean }): string[] {
  const out: string[] = []
  const n = network.nominatim
  if (on.search && n !== false) {
    if (n?.attribution) out.push(n.attribution)
    else if (!n?.url || n.url === NOMINATIM_URL) out.push(NOMINATIM_ATTRIBUTION)
    else warnOnce('network-attribution-nominatim', 'config.network.nominatim points at another server but sets no `attribution`: give it the provider\'s credit.')
  }
  const r = on.route ? routingAttribution(network.routing) : undefined
  if (r) out.push(r)
  return out
}

/**
 * This editor's routing: `config.network.routing`, with the deprecated `routingApiKey` prop as the
 * key when the config gives none (`network.routing.apiKey` wins).
 */
export function useRouting(routingApiKey?: string): RoutingConfig | false {
  const { routing } = useElementEditorConfig().network
  if (routingApiKey !== undefined) warnOnce('routingApiKey', 'The `routingApiKey` prop is deprecated: use `config.network.routing.apiKey`.')
  return useMemo(() => (routing === false ? false : routingApiKey && !routing?.apiKey ? { ...routing, apiKey: routingApiKey } : routing ?? {}), [routing, routingApiKey])
}

/** `serviceAttribution` for this editor, joined with " | " (a string, so it's stable while nothing changes). */
export function useServiceAttribution(routingApiKey?: string): string {
  const { network } = useElementEditorConfig()
  const routing = useRouting(routingApiKey)
  const search = useUIStore((s) => s.isToolAvailable('search'))
  const route = useUIStore((s) => s.isToolAvailable('route'))
  return serviceAttribution({ ...network, routing }, { search, route }).join(' | ')
}
