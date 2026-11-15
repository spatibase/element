import type { EmittedEvent } from '../contexts/EventContext'

/** A failed copy button: reported quietly (onError only); the button just doesn't show "Copied". */
export function clipboardErrorEvent(err: unknown): EmittedEvent {
  const name = (err as { name?: string } | null)?.name
  return {
    type: 'error',
    code: name === 'NotAllowedError' ? 'permission-denied' : name === 'TypeError' ? 'unsupported' : 'unknown',
    source: 'clipboard',
    message: 'Could not copy to the clipboard',
    cause: err,
    quiet: true,
  }
}
