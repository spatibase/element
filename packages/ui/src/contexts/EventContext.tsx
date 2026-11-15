import { createContext, useContext, useEffect, useId, useRef, useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ElementEditorError } from '@element-editor/core'
import { ElementToaster } from '../components/ui/ElementToaster'
import type { ElementEditorEvent, ElementEditorErrorHandler } from '../types/events'

/** Events whose default (unmanaged) handling shows a sonner toast. */
const TOASTED_EVENTS = new Set<string>(['feature:broken', 'selection:copied', 'selection:pasted', 'error', 'warning', 'success'])

/** Convert an ElementEditorEvent to a human-readable announcement string. */
function eventToAnnouncement(event: ElementEditorEvent): string | null {
  switch (event.type) {
    case 'feature:deleted': return `Deleted "${event.label}"`
    case 'features:deleted': return `Deleted ${event.count} features`
    case 'feature:duplicated': return `Duplicated "${event.label}"`
    case 'features:duplicated': return `Duplicated ${event.count} features`
    case 'feature:broken': return `Broken into ${event.count} features`
    case 'selection:copied': return 'Selection copied'
    case 'selection:pasted': return event.count === 1 ? 'Feature pasted' : `${event.count} features pasted`
    case 'undo': return 'Undone'
    case 'redo': return 'Redone'
    case 'error': return event.message
    case 'warning': return event.message
    case 'success': return event.message
    default: return null
  }
}

/**
 * A `ElementEditorEvent`, optionally carrying a secondary line for the default
 * toast. `onEvent` receives the same object (the extra field is ignored by
 * hosts typed against `ElementEditorEvent`). An `error` also takes what only
 * `onError` sees: `cause`, `featureId`, a prebuilt `error`, and `quiet`
 * (`onError` only — no toast, no `onEvent` event).
 */
export type EmittedEvent =
  | (Exclude<ElementEditorEvent, { type: 'error' }> & { description?: string })
  | (Extract<ElementEditorEvent, { type: 'error' }> & { cause?: unknown; featureId?: string; quiet?: boolean; error?: ElementEditorError })

type EmitFn = (event: EmittedEvent) => void

interface EventContextValue {
  emit: EmitFn
  /** True when the host app provided an `onEvent` handler (library is silent). */
  managed: boolean
  /** Sonner toaster id for this instance's own `<Toaster>`; undefined when toasts go to the host's toaster. */
  toasterId: string | undefined
}

export const EventContext = createContext<EventContextValue | null>(null)

/**
 * @internal Bridge so `uiStore` errors reach `emit` when `GeoStoreProvider`
 * wraps `EventProvider` (the store can't see a context below it). The store
 * provides the registrar; the EventProvider beneath registers its emit.
 */
export const StoreErrorSinkContext = createContext<((sink: StoreErrorSink | null) => void) | null>(null)
type StoreErrorSink = (error: ElementEditorError, opts?: { quiet?: boolean }) => void

export function EventProvider({
  onEvent,
  onError,
  toaster = false,
  children,
}: {
  onEvent?: (e: ElementEditorEvent) => void
  /** Called first for every runtime failure; see {@link ElementEditorErrorHandler} for the return value. Latest value is used. */
  onError?: ElementEditorErrorHandler
  /**
   * Render this instance's own `<Toaster>` and tag every default toast with its
   * id, so two editors on one page (or a host `<Toaster>`) never show the same
   * toast twice. Ignored when `onEvent` is set. Default false: toasts go to
   * whatever untagged `<Toaster>` the host renders.
   */
  toaster?: boolean
  children: ReactNode
}) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const parent = useContext(EventContext)
  const parentRef = useRef(parent)
  parentRef.current = parent
  const [announcement, setAnnouncement] = useState('')

  // managedRef is set once at mount; toggling onEvent after mount is not supported.
  const managedRef = useRef(!!onEvent)
  // A nested provider with neither `onEvent` nor its own toaster (an adapter's local one for
  // `onError`) runs its `onError`, then hands the event to the enclosing provider (its `onError`,
  // `onEvent` or toaster). Decided at mount, like `managed`.
  const delegateRef = useRef(!!parent && !onEvent && !toaster)
  const reactId = useId()
  const ownToasterId = toaster && !managedRef.current ? `elm-toaster-${reactId}` : undefined
  const toasterId = delegateRef.current ? parent?.toasterId : ownToasterId
  const managed = managedRef.current || (delegateRef.current && !!parent?.managed)

  const emit = useCallback<EmitFn>((input) => {
    let event: EmittedEvent = input
    if (input.type === 'error') {
      // onError first, always (also in managed mode and for quiet errors).
      const { cause, featureId, quiet, error, ...ev } = input
      const err = error ?? new ElementEditorError(ev.code, ev.source, ev.description ? `${ev.message}: ${ev.description}` : ev.message, { cause, featureId })
      let r: ReturnType<ElementEditorErrorHandler> = undefined
      try { r = onErrorRef.current?.(err) } catch (e) { console.error(e) }
      if (r === false || quiet) return
      event = typeof r === 'string' ? { ...ev, message: r, description: undefined } : { ...ev, error: err }
    }
    if (delegateRef.current && parentRef.current) {
      parentRef.current.emit(event)
      return
    }
    if (event.type === 'error') {
      const { error: _e, ...rest } = event
      event = rest
    }
    // ARIA live region: announce unless a sonner toast is about to show this
    // event — sonner's toaster is itself a live region, so announcing here too
    // reads every message twice. Managed mode (onEvent) always announces.
    const text = eventToAnnouncement(event)
    if (text && (onEventRef.current || !TOASTED_EVENTS.has(event.type))) {
      // Clear then set to ensure repeated identical messages are re-announced
      setAnnouncement('')
      requestAnimationFrame(() => setAnnouncement(text))
    }

    if (onEventRef.current) {
      onEventRef.current(event)
      return
    }

    // Default behaviour: fire sonner toasts.
    const opts = { toasterId, description: event.description }
    switch (event.type) {
      case 'feature:deleted':
      case 'features:deleted':
      case 'feature:duplicated':
      case 'features:duplicated':
        // No toast on delete or duplicate — the change is its own confirmation
        // (the feature appears or disappears on the map). Aria-live above keeps
        // screen readers informed; Cmd+Z still undoes.
        break
      case 'feature:broken':
        toast.success(`Broken into ${event.count} features`, {
          ...opts,
          action: { label: 'Undo', onClick: event.undo },
          duration: 5000,
        })
        break
      case 'selection:copied':
        toast.success('Copied selection', opts)
        break
      case 'selection:pasted':
        toast.success(event.count === 1 ? 'Pasted feature' : `Pasted ${event.count} features`, opts)
        break
      case 'undo':
      case 'redo':
        break
      case 'error':
        toast.error(event.message, opts)
        break
      case 'warning':
        toast.warning(event.message, opts)
        break
      case 'success':
        toast.success(event.message, opts)
        break
    }
  }, [toasterId])

  // Route uiStore geometry errors through emit when the store sits above us.
  const registerStoreErrorSink = useContext(StoreErrorSinkContext)
  useEffect(() => {
    if (!registerStoreErrorSink) return
    registerStoreErrorSink((error, opts) => emit({ type: 'error', code: error.code, source: error.source, message: error.message, error, quiet: opts?.quiet }))
    return () => registerStoreErrorSink(null)
  }, [registerStoreErrorSink, emit])

  const value = useMemo(() => ({ emit, managed, toasterId }), [emit, managed, toasterId])

  return (
    <EventContext.Provider value={value}>
      {children}
      {ownToasterId && <ElementToaster id={ownToasterId} position="bottom-right" />}
      {/* Visually hidden live region for screen reader announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </div>
    </EventContext.Provider>
  )
}

/** Returns a stable `emit` function for firing `ElementEditorEvent`s. */
export function useEmit(): EmitFn {
  const ctx = useContext(EventContext)
  if (!ctx) throw new Error('useEmit must be used within EventProvider')
  return ctx.emit
}

/**
 * Returns `true` when the host app supplied an `onEvent` handler.
 * Use this to skip loading-spinner toasts that have no `ElementEditorEvent` equivalent.
 */
export function useIsManaged(): boolean {
  return useContext(EventContext)?.managed ?? false
}

/**
 * Sonner `toasterId` for direct `toast.loading(...)` calls that have no
 * `ElementEditorEvent` equivalent — pass it as `{ toasterId }` so the toast lands
 * in this instance's `<Toaster>`. Undefined means "the host's toaster".
 */
export function useToasterId(): string | undefined {
  return useContext(EventContext)?.toasterId
}

/** `emit` of the enclosing EventProvider, or undefined outside one (e.g. a BYO-map `BasemapControl`). */
export function useOptionalEmit(): EmitFn | undefined {
  return useContext(EventContext)?.emit
}
