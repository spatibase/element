import React from 'react'
import { Keyboard, Check, SlidersHorizontal, Table, TreeStructure, Code } from '@phosphor-icons/react'
import {
  FloatingToolbar,
  UndoButton,
  RedoButton,
  FitBoundsButton,
  LocateButton,
  ZoomIndicator,
  useShortcutConfig,
  useUIStore,
  IconButton,
  KbdDark,
  Button,
} from '@element-editor/ui'
import type { LayoutControl, IconButtonSize, TooltipSide } from '@element-editor/ui'

function ShortcutsButton({ size, tooltipSide }: { size?: IconButtonSize; tooltipSide?: TooltipSide }) {
  const open = useUIStore((s) => s.shortcutsModalOpen)
  const openShortcutsModal = useUIStore((s) => s.openShortcutsModal)
  const closeShortcutsModal = useUIStore((s) => s.closeShortcutsModal)
  const { getKey } = useShortcutConfig()
  const key = getKey('show-shortcuts').toUpperCase()

  return (
    <IconButton
      label="Show keyboard shortcuts"
      shortcutId="show-shortcuts"
      tooltipContent="Keyboard shortcuts"
      shortcut={<KbdDark>{key}</KbdDark>}
      onClick={open ? closeShortcutsModal : openShortcutsModal}
      active={open}
      size={size}
      tooltipSide={tooltipSide}
    >
      <Keyboard size={24} />
    </IconButton>
  )
}

function TableButton({ size, side }: { size: IconButtonSize; side: TooltipSide }) {
  const open = useUIStore((s) => s.tableOpen)
  const toggleTable = useUIStore((s) => s.toggleTable)
  const { getKey } = useShortcutConfig()
  return (
    <IconButton size={size} tooltipSide={side}
      label={open ? 'Hide table' : 'Show table'}
      shortcutId="toggle-table"
      shortcut={<KbdDark>{getKey('toggle-table').toUpperCase()}</KbdDark>}
      onClick={toggleTable}
      active={open}
    >
      <Table size={24} />
    </IconButton>
  )
}

function SchemaButton({ size, side }: { size: IconButtonSize; side: TooltipSide }) {
  const open = useUIStore((s) => s.schemaModalOpen)
  const toggleSchemaModal = useUIStore((s) => s.toggleSchemaModal)
  const { getKey } = useShortcutConfig()
  return (
    <IconButton size={size} tooltipSide={side}
      label="Edit schema"
      shortcutId="toggle-schema"
      shortcut={<KbdDark>{getKey('toggle-schema').toUpperCase()}</KbdDark>}
      onClick={toggleSchemaModal}
      active={open}
    >
      <TreeStructure size={24} />
    </IconButton>
  )
}

function GeoJSONButton({ size, side }: { size: IconButtonSize; side: TooltipSide }) {
  const open = useUIStore((s) => s.codeModalOpen)
  const toggleCodeModal = useUIStore((s) => s.toggleCodeModal)
  const { getKey } = useShortcutConfig()
  return (
    <IconButton size={size} tooltipSide={side}
      label="Show GeoJSON"
      shortcutId="toggle-geojson"
      shortcut={<KbdDark>{getKey('toggle-geojson').toUpperCase()}</KbdDark>}
      onClick={toggleCodeModal}
      active={open}
    >
      <Code size={24} />
    </IconButton>
  )
}

function SettingsButton({ size, side }: { size: IconButtonSize; side: TooltipSide }) {
  const open = useUIStore((s) => s.settingsModalOpen)
  const setSettingsModalOpen = useUIStore((s) => s.setSettingsModalOpen)
  return (
    <IconButton size={size} tooltipSide={side}
      label="Editor settings"
      onClick={() => setSettingsModalOpen(!open)}
      active={open}
    >
      <SlidersHorizontal size={24} />
    </IconButton>
  )
}

export interface ShellControlProps {
  id: LayoutControl
  size: IconButtonSize
  side: TooltipSide
  /** `applyChanges` click handler (the imperative API's `submit`). */
  onSubmit: () => void
  /** Rendered for `basemap`; built by the engine wrapper. */
  basemapControl?: React.ReactNode
  /** Receives the status-bar element the engine's map view moves its attribution control into. */
  attributionRef: (el: HTMLElement | null) => void
}

/**
 * One layout control. Each toggle button subscribes to its own store slice,
 * so opening the table / schema / GeoJSON / settings re-renders only that
 * button, not the whole shell.
 */
export function ShellControl({ id, size, side, onSubmit, basemapControl, attributionRef }: ShellControlProps) {
  switch (id) {
    case 'toolbar':       return <FloatingToolbar embedded />
    case 'undo':          return <UndoButton size={size} tooltipSide={side} />
    case 'redo':          return <RedoButton size={size} tooltipSide={side} />
    case 'fitBounds':     return <FitBoundsButton size={size} tooltipSide={side} />
    case 'locate':        return <LocateButton size={size} tooltipSide={side} />
    case 'zoomIndicator': return <ZoomIndicator size={size} tooltipSide={side} />
    case 'table':         return <TableButton size={size} side={side} />
    case 'schema':        return <SchemaButton size={size} side={side} />
    case 'geojson':       return <GeoJSONButton size={size} side={side} />
    case 'settings':      return <SettingsButton size={size} side={side} />
    case 'keyboard':      return <ShortcutsButton size={size} tooltipSide={side} />
    case 'applyChanges':  return (
      <Button variant="primary" onClick={onSubmit}
        className={size === 'group' ? 'h-8 !rounded-elm-control !px-3 gap-1.5 !text-sm' : 'h-12 !rounded-elm shadow-elm-control !px-5 gap-2 !text-sm'}>
        <Check size={20} weight="bold" />
        Apply changes
      </Button>
    )
    case 'attribution':   return (
      <span ref={attributionRef} data-elm-attribution=""
        // Full text on hover; the control's content changes with the layers.
        onMouseEnter={(ev) => { ev.currentTarget.title = ev.currentTarget.textContent?.trim() ?? '' }} />
    )
    // The control is built by the engine wrapper, so it gets the slot's size and tooltip side here (compact in the status bar).
    case 'basemap':       return React.isValidElement(basemapControl)
      ? React.cloneElement(basemapControl as React.ReactElement<{ size?: IconButtonSize; tooltipSide?: TooltipSide }>, { size, tooltipSide: side })
      : null
    default: return null
  }
}
