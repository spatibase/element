import { useEffect, useState } from 'react'
import { readAccentPalette, type AccentPalette } from '@element-editor/core'
import { watchThemeInputs } from './themeInputs'

const same = (a: AccentPalette, b: AccentPalette) =>
  (Object.keys(a) as unknown as (keyof AccentPalette)[]).every((k) => a[k] === b[k])

/**
 * The palette in effect for `el`, as the CSS resolves it (accent and any
 * `--elm-primary-N` override), for map renderers that need concrete colours
 * (Leaflet SVG attributes, MapLibre paint). Re-reads, once per frame at most,
 * when the `style`/`class` of the nearest `[data-elm-theme]` ancestor or
 * `<html>` changes, when `<head>` gains/loses/edits a stylesheet, or when a
 * `<link>` finishes loading. Returns the same object while nothing changed.
 * HTML (divIcons, marker elements) can use `var(--color-primary-N)` directly.
 *
 * ponytail: CSSOM edits (insertRule, adoptedStyleSheets, constructable sheets)
 * and <style> outside <head> fire no event; re-set the accent on the root to
 * nudge it if a host does that.
 */
export function useAccentPalette(el: HTMLElement | null): AccentPalette {
  const [palette, setPalette] = useState(() => readAccentPalette(el))

  useEffect(() => {
    // Read eagerly, not in a state updater: React may run an updater inside a
    // later (possibly long) render, and getComputedStyle forces a style recalc there.
    const update = () => {
      const next = readAccentPalette(el)
      setPalette((prev) => (same(prev, next) ? prev : next))
    }
    let frame = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update() }) }
    update()
    const stop = watchThemeInputs(el?.closest('[data-elm-theme]') ?? null, schedule)
    return () => {
      stop()
      cancelAnimationFrame(frame)
    }
  }, [el])

  return palette
}
