import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useInlineRename } from '../../../../ui/src/hooks/useInlineRename'

// Minimal host that exposes the hook through a visible <input> / <span> and
// forwards the controlled `activate` / `onEnd` / `onTab` surface so tests can
// assert on parent-driven rename navigation.
function RenameHost({
  initialLabel,
  onCommit,
  activate,
  onEnd,
  onTab,
  autoFocus,
}: {
  initialLabel: string
  onCommit: (name: string) => void
  activate?: boolean
  onEnd?: () => void
  onTab?: (direction: 'next' | 'prev') => void
  autoFocus?: boolean
}) {
  const { isRenaming, startRenaming, inputProps } = useInlineRename({
    initialLabel,
    onCommit,
    activate,
    onEnd,
    onTab,
    autoFocus,
  })
  return isRenaming ? (
    <input data-testid="rename-input" {...inputProps} />
  ) : (
    <span data-testid="rename-label" onDoubleClick={() => startRenaming(initialLabel)}>
      {initialLabel}
    </span>
  )
}

// Two hosts driven by a single parent-controlled `renamingId` — mirrors how
// FeatureList coordinates rename navigation between rows.
function TwoRowHost({
  labels,
  onCommit,
  initialRenamingId = null,
  onAdvance,
}: {
  labels: [string, string]
  onCommit: (rowId: string, name: string) => void
  initialRenamingId?: string | null
  onAdvance?: (fromId: string, direction: 'next' | 'prev') => string | null
}) {
  const [renamingId, setRenamingId] = useState<string | null>(initialRenamingId)
  const handleTab = (rowId: string, direction: 'next' | 'prev') => {
    const next = onAdvance?.(rowId, direction) ?? null
    setRenamingId(next)
  }
  return (
    <>
      {labels.map((label, i) => {
        const rowId = `row-${i}`
        return (
          <RenameHost
            key={rowId}
            initialLabel={label}
            onCommit={(name) => onCommit(rowId, name)}
            activate={renamingId === rowId}
            onEnd={() => setRenamingId((prev) => (prev === rowId ? null : prev))}
            onTab={(direction) => handleTab(rowId, direction)}
          />
        )
      })}
    </>
  )
}

describe('useInlineRename', () => {
  it('commits via Enter and fires onEnd', async () => {
    const onCommit = vi.fn()
    const onEnd = vi.fn()
    render(<RenameHost initialLabel="Alpha" onCommit={onCommit} onEnd={onEnd} autoFocus />)

    const input = screen.getByTestId('rename-input')
    const user = userEvent.setup()
    // autoFocus + the hook's focus-and-select effect means the initial value
    // is selected — typing replaces it.
    await user.keyboard('Beta')
    await user.keyboard('{Enter}')

    expect(onCommit).toHaveBeenCalledWith('Beta')
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('rename-input')).toBeNull()
    // input is now unmounted, label is shown
    expect(screen.getByTestId('rename-label')).toBeInTheDocument()
  })

  it('Escape cancels without committing', async () => {
    const onCommit = vi.fn()
    const onEnd = vi.fn()
    render(<RenameHost initialLabel="Alpha" onCommit={onCommit} onEnd={onEnd} autoFocus />)

    const user = userEvent.setup()
    await user.keyboard('Garbage')
    await user.keyboard('{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('rename-input')).toBeNull()
  })

  it('skips onCommit when the value is unchanged', async () => {
    const onCommit = vi.fn()
    render(<RenameHost initialLabel="Alpha" onCommit={onCommit} autoFocus />)
    const user = userEvent.setup()
    await user.keyboard('{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Tab commits the current row and does not call onEnd', async () => {
    const onCommit = vi.fn()
    const onEnd = vi.fn()
    const onTab = vi.fn()
    render(
      <RenameHost
        initialLabel="Alpha"
        onCommit={onCommit}
        onEnd={onEnd}
        onTab={onTab}
        autoFocus
      />
    )

    const user = userEvent.setup()
    await user.keyboard('Alfa')
    await user.tab()

    expect(onCommit).toHaveBeenCalledWith('Alfa')
    // onEnd is reserved for commit/cancel exits; Tab relies on parent to move
    // focus, so it must NOT clear parent's `renamingId`.
    expect(onEnd).not.toHaveBeenCalled()
    expect(onTab).toHaveBeenCalledWith('next')
  })

  it('Shift+Tab calls onTab with direction "prev"', async () => {
    const onTab = vi.fn()
    render(
      <RenameHost initialLabel="Alpha" onCommit={vi.fn()} onTab={onTab} autoFocus />
    )
    const user = userEvent.setup()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(onTab).toHaveBeenCalledWith('prev')
  })

  it('activates rename when the `activate` prop flips true', async () => {
    function Harness() {
      const [active, setActive] = useState(false)
      return (
        <>
          <button data-testid="trigger" onClick={() => setActive(true)}>go</button>
          <RenameHost initialLabel="Alpha" onCommit={vi.fn()} activate={active} />
        </>
      )
    }
    render(<Harness />)
    expect(screen.queryByTestId('rename-input')).toBeNull()
    await userEvent.setup().click(screen.getByTestId('trigger'))
    expect(screen.getByTestId('rename-input')).toBeInTheDocument()
    expect(screen.getByTestId('rename-input')).toHaveFocus()
  })
})

describe('useInlineRename — Tab navigation across rows', () => {
  it('Tab commits row 0 then activates row 1', async () => {
    const commits: Array<[string, string]> = []
    render(
      <TwoRowHost
        labels={['Alpha', 'Bravo']}
        initialRenamingId="row-0"
        onCommit={(rowId, name) => commits.push([rowId, name])}
        onAdvance={(fromId, dir) => {
          const order = ['row-0', 'row-1']
          const idx = order.indexOf(fromId)
          const nextIdx = dir === 'next' ? idx + 1 : idx - 1
          return order[nextIdx] ?? null
        }}
      />
    )

    const user = userEvent.setup()
    // row-0 auto-activated via initialRenamingId; type & tab forward
    await user.keyboard('Alfa')
    await user.tab()

    expect(commits).toEqual([['row-0', 'Alfa']])
    // Only row-1's input should now be live.
    const inputs = screen.getAllByTestId('rename-input')
    expect(inputs).toHaveLength(1)
    expect((inputs[0] as HTMLInputElement).value).toBe('Bravo')
    expect(inputs[0]).toHaveFocus()
  })

  it('Shift+Tab from row 1 commits and reactivates row 0', async () => {
    const commits: Array<[string, string]> = []
    render(
      <TwoRowHost
        labels={['Alpha', 'Bravo']}
        initialRenamingId="row-1"
        onCommit={(rowId, name) => commits.push([rowId, name])}
        onAdvance={(fromId, dir) => {
          const order = ['row-0', 'row-1']
          const idx = order.indexOf(fromId)
          const nextIdx = dir === 'next' ? idx + 1 : idx - 1
          return order[nextIdx] ?? null
        }}
      />
    )

    const user = userEvent.setup()
    await user.keyboard('Beta')
    await user.keyboard('{Shift>}{Tab}{/Shift}')

    expect(commits).toEqual([['row-1', 'Beta']])
    const inputs = screen.getAllByTestId('rename-input')
    expect(inputs).toHaveLength(1)
    expect((inputs[0] as HTMLInputElement).value).toBe('Alpha')
  })

  it('Tab past the last row commits and exits rename mode', async () => {
    const commits: Array<[string, string]> = []
    render(
      <TwoRowHost
        labels={['Alpha', 'Bravo']}
        initialRenamingId="row-1"
        onCommit={(rowId, name) => commits.push([rowId, name])}
        onAdvance={(fromId, dir) => {
          const order = ['row-0', 'row-1']
          const idx = order.indexOf(fromId)
          const nextIdx = dir === 'next' ? idx + 1 : idx - 1
          return order[nextIdx] ?? null
        }}
      />
    )

    const user = userEvent.setup()
    await user.keyboard('Beta')
    await user.tab()

    expect(commits).toEqual([['row-1', 'Beta']])
    // No input remains — we've exited rename mode at the boundary.
    expect(screen.queryAllByTestId('rename-input')).toHaveLength(0)
  })
})

// Silences a React 19 deprecation warning caused indirectly by testing-library.
void act
