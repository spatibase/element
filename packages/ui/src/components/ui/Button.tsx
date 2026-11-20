import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'success'
  | 'emerald'
  | 'warning'
  | 'dashed'

export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm'

const variants: Record<ButtonVariant, string> = {
  primary:   'bg-primary-500 text-white hover:bg-primary-600 disabled:hover:bg-primary-500',
  secondary: 'bg-elm-surface-hover text-elm-text-secondary hover:bg-(--elm-surface-hover,var(--color-gray-200)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) disabled:hover:bg-elm-surface-hover',
  ghost:     'text-elm-text-muted hover:bg-elm-surface-hover hover:text-(--elm-text-secondary,var(--color-gray-700)) dark:hover:text-(--elm-text-secondary,var(--color-gray-300)) disabled:hover:bg-transparent',
  success:   'bg-green-500 text-white hover:bg-green-600 disabled:hover:bg-green-500',
  emerald:   'bg-emerald-500 text-white hover:bg-emerald-600 disabled:hover:bg-emerald-500',
  warning:   'bg-amber-500 text-white hover:bg-amber-600 disabled:hover:bg-amber-500',
  dashed:    'text-primary-500 hover:text-primary-700 hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-black)_5%,transparent)) dark:hover:bg-(--elm-control-hover,color-mix(in_oklab,var(--color-white)_5%,transparent)) disabled:hover:bg-transparent border border-dashed border-primary-300 hover:border-primary-500 dark:text-primary-400 dark:border-primary-700 dark:hover:border-primary-500',
}

const sizes: Record<ButtonSize, string> = {
  sm:       'px-2 py-1 text-xs rounded-elm-card',
  md:       'px-3 py-1.5 text-sm rounded-elm-control',
  icon:     'w-7 h-7 rounded-elm-card',
  'icon-sm':'w-6 h-6 rounded-elm-chip',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = /*#__PURE__*/ forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={clsx(
        'transition-colors flex items-center justify-center gap-1.5',
        'active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})
Button.displayName = 'Button'
