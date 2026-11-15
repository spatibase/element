import { useState } from 'react'
import { NavigationArrow } from '@phosphor-icons/react'
import { useMapController } from '../contexts/MapControllerContext'
import { useEmit } from '../contexts/EventContext'
import { IconButton, type IconButtonSize } from './ui/IconButton'
import type { TooltipSide } from './ui/Tooltip'

interface Props {
  /** Zoom level to fly to after locating. Default 15 (street-level). */
  zoom?: number
  /** `'sm'` for the status bar, `'group'` inside a joined pill. Default `'md'`. */
  size?: IconButtonSize
  tooltipSide?: TooltipSide
}

export default function LocateButton({ zoom = 15, size, tooltipSide }: Props) {
  const { flyTo } = useMapController()
  const emit = useEmit()
  const [loading, setLoading] = useState(false)

  function handleLocate() {
    if (!navigator.geolocation) {
      emit({ type: 'error', code: 'unsupported', source: 'locate', message: 'Geolocation is not supported by this browser' })
      return
    }
    if (!flyTo) {
      emit({ type: 'warning', message: 'Map is not ready yet — try again in a moment' })
      return
    }
    if (loading) return
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false)
        flyTo([pos.coords.latitude, pos.coords.longitude], zoom)
      },
      (err) => {
        setLoading(false)
        emit({
          type: 'error',
          code: err.code === err.PERMISSION_DENIED ? 'permission-denied' : err.code === err.TIMEOUT ? 'timeout' : 'unknown',
          source: 'locate',
          cause: err,
          message: err.code === err.PERMISSION_DENIED
            ? 'Location access denied'
            : 'Could not determine your location',
        })
      },
      { timeout: 10000 }
    )
  }

  return (
    // Not `disabled` while locating: that fades the whole button (disabled
    // opacity). A repeat click is ignored in handleLocate instead.
    <IconButton label={loading ? 'Locating…' : 'Show my location'} onClick={handleLocate} size={size} tooltipSide={tooltipSide}>
      {loading
        ? <div className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'} border-2 border-current/25 border-t-current rounded-full animate-spin`} aria-hidden />
        : <NavigationArrow size={24} />
      }
    </IconButton>
  )
}
