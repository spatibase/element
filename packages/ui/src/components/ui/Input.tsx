import { clsx } from 'clsx'
import { CaretDown } from '@phosphor-icons/react'
import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'

const base = 'w-full h-9 px-2.5 py-1.5 text-sm border rounded-elm-control focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring focus:border-transparent bg-elm-surface-raised text-(--elm-text,var(--color-gray-900)) dark:text-(--elm-text,var(--color-gray-100)) placeholder:text-(--elm-text-subtle,var(--color-gray-400)) dark:placeholder:text-(--elm-text-subtle,var(--color-gray-600))'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export function Input({ error, className, ...props }: InputProps) {
  return (
    <input
      autoComplete="off"
      className={clsx(base, error ? 'border-rose-400' : 'border-(--elm-border-strong,var(--color-gray-300))', className)}
      {...props}
    />
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export function Textarea({ error, className, ...props }: TextareaProps) {
  return (
    <textarea
      autoComplete="off"
      className={clsx(base, 'resize-none h-auto', error ? 'border-rose-400' : 'border-(--elm-border-strong,var(--color-gray-300))', className)}
      {...props}
    />
  )
}

interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
}

export function SelectInput({ error, className, children, ...props }: SelectInputProps) {
  return (
    // Native arrow is hidden (appearance-none) — it can't be padded reliably
    // and sits flush against the right border. Draw our own caret with the
    // same right inset as the left text padding.
    <div className="relative w-full">
      <select
        className={clsx(base, 'appearance-none pr-8', error ? 'border-rose-400' : 'border-(--elm-border-strong,var(--color-gray-300))', className)}
        {...props}
      >
        {children}
      </select>
      <CaretDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-elm-text-muted" />
    </div>
  )
}
