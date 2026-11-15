import { useState, useRef, useEffect } from 'react'

interface UseInlineRenameOptions {
  initialLabel: string
  onCommit: (name: string) => void
  autoFocus?: boolean
  /** When this becomes true, activates rename mode (parent-driven, e.g. via Tab navigation). */
  activate?: boolean
  /** Called after commit or cancel, so parent can clear its activation id. */
  onEnd?: () => void
  /** Called when Tab / Shift+Tab is pressed inside the input. Parent should commit-and-advance. */
  onTab?: (direction: 'next' | 'prev') => void
  /** No renaming (readonly editor): `startRenaming` and `activate` do nothing. */
  disabled?: boolean
}

export function useInlineRename({ initialLabel, onCommit, autoFocus, activate, onEnd, onTab, disabled }: UseInlineRenameOptions) {
  const [isRenaming, setIsRenaming] = useState(() => !disabled && (!!autoFocus || !!activate))
  const [draft, setDraft] = useState(initialLabel)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activate && !isRenaming && !disabled) {
      setDraft(initialLabel)
      setIsRenaming(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activate])

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isRenaming])

  function startRenaming(label: string) {
    if (disabled) return
    setDraft(label)
    setIsRenaming(true)
  }

  function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== initialLabel) {
      onCommit(trimmed)
    }
    setIsRenaming(false)
    onEnd?.()
  }

  function cancelRename() {
    setDraft(initialLabel)
    setIsRenaming(false)
    onEnd?.()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.nativeEvent.stopImmediatePropagation()
      commitRename()
      return
    }
    if (e.key === 'Escape') {
      e.nativeEvent.stopImmediatePropagation()
      cancelRename()
      return
    }
    if (e.key === 'Tab' && onTab) {
      e.preventDefault()
      e.nativeEvent.stopImmediatePropagation()
      const trimmed = draft.trim()
      if (trimmed && trimmed !== initialLabel) onCommit(trimmed)
      setIsRenaming(false)
      onTab(e.shiftKey ? 'prev' : 'next')
    }
  }

  /** Props to spread onto the <input> element */
  const inputProps = {
    ref: inputRef,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commitRename,
    onKeyDown: handleKeyDown,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  }

  return { isRenaming, startRenaming, inputProps }
}
