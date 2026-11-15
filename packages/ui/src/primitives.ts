/**
 * @element-editor/ui/primitives
 *
 * Lightweight base UI components with no map or store dependencies.
 * Use this entry point when building custom layouts with adapter packages.
 *
 * @example
 *   import { Button, Tooltip, Input } from '@element-editor/ui/primitives'
 */

export { Button } from './components/ui/Button'
export type { ButtonVariant, ButtonSize } from './components/ui/Button'
export { ContextMenu } from './components/ui/ContextMenu'
export { Input, Textarea, SelectInput } from './components/ui/Input'
export { Kbd, KbdDark, KbdInvert } from './components/ui/Kbd'
export { SearchDropdown } from './components/ui/SearchDropdown'
export type { SearchDropdownHandle } from './components/ui/SearchDropdown'
export { ToolButton } from './components/ui/ToolButton'
export { Tooltip } from './components/ui/Tooltip'
export { EditToolbarBtn, ToolbarDivider } from './components/ui/EditToolbarBtn'
