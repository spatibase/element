import { useCallback, useMemo, useRef, useState } from 'react'
import { warnOnce } from '@element-editor/core/internal'

/** Ref methods both drop-ins add for the basemap (`B` = the entry's basemap type). */
export interface BasemapRefAPI<B> {
  /** The current basemap, as passed in `basemap` / `basemaps` (`'auto'` stays `'auto'`). */
  getBasemap: () => B
  /**
   * Switches the basemap like a user pick, except that it isn't remembered for the next visit.
   * Fires `onBasemapChange`. With a controlled `basemap` it only fires `onBasemapChange`.
   */
  setBasemap: (basemap: B) => void
}

/**
 * Controlled (`value` set) / uncontrolled basemap choice shared by both drop-ins. `initial` (read
 * once, uncontrolled only) gives the remembered pick or the default; `remember` stores a user pick
 * (uncontrolled only). `pick(b, true)` is a picker click, `api.setBasemap` a programmatic one.
 */
export function useBasemapState<B>(
  value: B | undefined,
  initial: () => B,
  onChange: ((basemap: B) => void) | undefined,
  remember: (basemap: B) => void,
  pickerShown: boolean,
) {
  const controlled = value !== undefined
  if (controlled && pickerShown && !onChange) {
    warnOnce('basemap-controlled', '<ElementEditor basemap> is controlled: the picker can\'t change it without `onBasemapChange`. Pass `onBasemapChange` (and update `basemap` in it), or use `defaultBasemap` for a starting basemap the user can change.')
  }
  const [inner, setInner] = useState<B>(() => (value !== undefined ? value : initial()))
  const current = controlled ? value : inner
  const latest = useRef({ current, controlled, onChange, remember })
  latest.current = { current, controlled, onChange, remember }

  const pick = useCallback((b: B, fromUser: boolean) => {
    const l = latest.current
    if (!l.controlled) {
      setInner(b)
      if (fromUser) l.remember(b)
    }
    l.onChange?.(b)
  }, [])
  const api = useMemo<BasemapRefAPI<B>>(() => ({
    getBasemap: () => latest.current.current,
    setBasemap: (b) => pick(b, false),
  }), [pick])
  return { current, pick, api }
}
