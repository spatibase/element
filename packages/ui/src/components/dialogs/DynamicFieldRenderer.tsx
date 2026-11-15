import { Input, Textarea, SelectInput } from '../ui/Input'
import type { SchemaField } from '@element-editor/core'
import { readBooleanValue } from '../../utils/booleanValue'

interface Props {
  fields: SchemaField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  errors?: Record<string, string>
  autoFocusFirst?: boolean
  readonly?: boolean
}

export default function DynamicFieldRenderer({ fields, values, onChange, errors, autoFocusFirst, readonly }: Props) {
  return (
    <div className="space-y-3">
      {fields.map((field, index) => {
        const value = values[field.key] ?? ''
        const error = errors?.[field.key]
        const isFirst = autoFocusFirst && index === 0

        const label = (
          <label className="block text-xs font-medium text-(--elm-text-muted,var(--color-gray-600)) dark:text-(--elm-text-muted,var(--color-gray-400)) mb-1">
            {field.label}
            {field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
        )

        let input: React.ReactNode

        if (field.type === 'boolean') {
          return (
            <div key={field.key} data-field-key={field.key} className="flex items-center justify-between py-1 border-b border-transparent">
              {label}
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={readBooleanValue(value)} 
                  onChange={(e) => onChange(field.key, e.target.checked)} 
                  disabled={readonly}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-(--elm-border-strong,var(--color-gray-200)) peer-focus-visible:ring-2 peer-focus-visible:ring-elm-focus-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-elm-surface rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-(--elm-border-strong,var(--color-gray-300)) after:border after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:bg-primary-500 opacity-90 hover:opacity-100 disabled:opacity-50"></div>
              </label>
              {error && <p className="mt-1 text-xs text-rose-500 w-full basis-full">{error}</p>}
            </div>
          )
        }

        if (field.type === 'textarea') {
          input = (
            <Textarea
              rows={3}
              value={String(value)}
              onChange={(e) => onChange(field.key, e.target.value)}
              autoFocus={isFirst}
              error={!!error}
              disabled={readonly}
            />
          )
        } else if (field.type === 'select') {
          input = (
            <SelectInput
              value={String(value)}
              onChange={(e) => onChange(field.key, e.target.value)}
              autoFocus={isFirst}
              error={!!error}
              disabled={readonly}
            >
              <option value="">— select —</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </SelectInput>
          )
        } else if (field.type === 'number') {
          input = (
            <Input
              type="number"
              value={String(value)}
              onChange={(e) => onChange(field.key, e.target.value)}
              autoFocus={isFirst}
              error={!!error}
              disabled={readonly}
              min={field.min}
              max={field.max}
            />
          )
        } else {
          input = (
            <Input
              type={field.type}
              value={String(value)}
              onChange={(e) => onChange(field.key, e.target.value)}
              autoFocus={isFirst}
              error={!!error}
              disabled={readonly}
            />
          )
        }

        return (
          // `data-field-key` lets the parent panel focus the offending input
          // by key after a failed save (see handleSave in FeatureSidePanel).
          <div key={field.key} data-field-key={field.key}>
            {label}
            {input}
            {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
          </div>
        )
      })}
    </div>
  )
}
