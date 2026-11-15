import type { CSSProperties } from 'react'
import { Toaster, type ToasterProps } from 'sonner'
import { useTheme } from '../../contexts/ThemeContext'
import { useAccentStyle } from '../../hooks/useAccentStyle'

// Quiet toasts: no type icons, no type colours (no richColors).
const NO_ICONS = { success: null, info: null, warning: null, error: null }

// Same surface as the editor's panels in each theme (sonner's own dark toast
// is pure black on a #333 border, which reads as a hole next to them). Design
// tokens win when set; the fallbacks are the look before them. The
// font falls back to sonner's own stack, the radius to its 8px.
const SONNER_FONT = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji'
const SURFACE: Record<'light' | 'dark', CSSProperties> = {
  light: { '--normal-bg': 'var(--elm-surface, #ffffff)', '--normal-border': 'var(--elm-border, rgb(0 0 0 / 0.1))', '--normal-text': 'var(--elm-text, #171717)' } as CSSProperties,
  dark: { '--normal-bg': 'var(--elm-surface, #171717)', '--normal-border': 'var(--elm-border, rgb(255 255 255 / 0.1))', '--normal-text': 'var(--elm-text, #fafafa)' } as CSSProperties,
}
const SHAPE = { '--border-radius': 'calc(var(--elm-radius-control, 6px) + 2px)', fontFamily: `var(--elm-font, ${SONNER_FONT})` } as CSSProperties
// Muted description on each surface.
const DESCRIPTION = { light: '!text-(--elm-text-muted,#737373)', dark: '!text-(--elm-text-muted,#a3a3a3)' }

/** sonner `<Toaster>` styled like Element: follows the editor's resolved theme (dark toast on a dark editor), panel surface, no icons. */
export function ElementToaster(props: ToasterProps) {
  const theme = useTheme()
  // The editor root's custom design tokens (the toaster may sit outside the root).
  const tokens = useAccentStyle()
  const { toastOptions, style } = props
  return (
    <Toaster
      theme={theme}
      icons={NO_ICONS}
      {...props}
      style={{ ...tokens, ...SURFACE[theme], ...SHAPE, ...style }}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          // Compact: sonner's default 16px padding → 11px; title 500 → 400.
          toast: `!p-[11px] ${toastOptions?.classNames?.toast ?? ''}`,
          title: `!font-normal ${toastOptions?.classNames?.title ?? ''}`,
          description: `${DESCRIPTION[theme]} ${toastOptions?.classNames?.description ?? ''}`,
        },
      }}
    />
  )
}
