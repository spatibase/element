import type { EditingMode } from '@element-editor/core'

/** The map cursor a tool mode owns (DrawingLayer sets it): crosshair while any tool is active. */
export const toolCursor = (mode: EditingMode): string => (mode !== 'none' ? 'crosshair' : '')
