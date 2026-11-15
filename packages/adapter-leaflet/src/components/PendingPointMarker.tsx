import { Marker } from 'react-leaflet'
import { useUIStore } from '../store/StoreContext'
import { toLeaflet } from '../utils/geojson'
import { divIcon } from 'leaflet'
import { PIN_PATH } from '../utils/pinPath'

function makePendingPointIcon() {
  return divIcon({
    className: '',
    html: `<div style="position:relative;width:20px;height:28px">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28" style="position:relative;z-index:1;display:block">
        <path d="${PIN_PATH}" fill-rule="evenodd" style="fill:var(--color-primary-500)"/>
      </svg>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  })
}

/** Shows the pin on the map while the user fills in the new-point form in the sidebar. */
export function PendingPointMarker() {
  const dialogState = useUIStore((s) => s.dialogState)
  if (dialogState.type !== 'new-point') return null
  return <Marker position={toLeaflet(dialogState.coords)} icon={makePendingPointIcon()} interactive={false} />
}
