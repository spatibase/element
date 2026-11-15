import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DynamicFieldRenderer from '../../../../ui/src/components/dialogs/DynamicFieldRenderer'
import type { SchemaField } from '@element-editor/core'

function field(overrides: Partial<SchemaField> & Pick<SchemaField, 'key' | 'label' | 'type'>): SchemaField {
  return { required: false, ...overrides }
}

describe('DynamicFieldRenderer', () => {
  it('renders a text input for type=text', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text' })]}
        values={{ name: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders a textarea for type=textarea', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'desc', label: 'Description', type: 'textarea' })]}
        values={{ desc: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA')
  })

  it('renders input[type=url] for type=url', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'url', label: 'URL', type: 'url' })]}
        values={{ url: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'url')
  })

  it('renders input[type=number] for type=number', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'rating', label: 'Rating', type: 'number' })]}
        values={{ rating: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('spinbutton')).toHaveAttribute('type', 'number')
  })

  it('renders a select with options for type=select', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'cat', label: 'Category', type: 'select', options: ['restaurant', 'landmark'] })]}
        values={{ cat: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'restaurant' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'landmark' })).toBeInTheDocument()
  })

  it('shows a required asterisk for required fields', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text', required: true })]}
        values={{ name: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('does not show asterisk for non-required fields', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'desc', label: 'Description', type: 'text', required: false })]}
        values={{ desc: '' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('pre-fills the input with the current value', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text' })]}
        values={{ name: 'Eiffel Tower' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox')).toHaveValue('Eiffel Tower')
  })

  it('calls onChange with the correct key and new value', async () => {
    const onChange = vi.fn()
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text' })]}
        values={{ name: '' }}
        onChange={onChange}
      />
    )
    await userEvent.type(screen.getByRole('textbox'), 'A')
    expect(onChange).toHaveBeenCalledWith('name', 'A')
  })

  it('shows an error message when errors contains the field key', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text', required: true })]}
        values={{ name: '' }}
        onChange={vi.fn()}
        errors={{ name: 'Name is required' }}
      />
    )
    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })

  it('applies rose border class when field has an error', () => {
    render(
      <DynamicFieldRenderer
        fields={[field({ key: 'name', label: 'Name', type: 'text', required: true })]}
        values={{ name: '' }}
        onChange={vi.fn()}
        errors={{ name: 'Name is required' }}
      />
    )
    expect(screen.getByRole('textbox')).toHaveClass('border-rose-400')
  })

  it('renders multiple fields in order', () => {
    render(
      <DynamicFieldRenderer
        fields={[
          field({ key: 'name', label: 'Name', type: 'text' }),
          field({ key: 'desc', label: 'Description', type: 'textarea' }),
        ]}
        values={{ name: '', desc: '' }}
        onChange={vi.fn()}
      />
    )
    const labels = screen.getAllByRole('textbox')
    expect(labels).toHaveLength(2)
  })
})
