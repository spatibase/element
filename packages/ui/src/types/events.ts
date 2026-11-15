import type { ElementEditorError, ErrorCode, ErrorSource } from '@element-editor/core'

/**
 * Events emitted by the Element library.
 *
 * Pass an `onEvent` prop to `<ElementEditor>` to receive these instead of (or in
 * addition to) the built-in sonner toasts. When `onEvent` is provided the
 * library goes fully silent — no `<Toaster>` is rendered and no toasts are
 * fired. The host app is responsible for surfacing notifications.
 *
 * @example
 * ```tsx
 * <ElementEditor
 *   onEvent={(e) => {
 *     if (e.type === 'feature:deleted') myToast(`Deleted "${e.label}"`)
 *     if (e.type === 'error') console.error(e.code, e.message)
 *   }}
 * />
 * ```
 */
export type ElementEditorEvent =
  // ── Feature lifecycle ────────────────────────────────────────────────────
  /** A single feature was deleted. `undo()` reverts the deletion. */
  | { type: 'feature:deleted'; featureId: string; label: string; undo: () => void }
  /** Multiple features were deleted at once. `undo()` reverts the deletion. */
  | { type: 'features:deleted'; count: number; undo: () => void }
  /** A single feature was duplicated. */
  | { type: 'feature:duplicated'; featureId: string; label: string }
  /** Multiple features were duplicated at once. */
  | { type: 'features:duplicated'; count: number }
  /** A multi-geometry feature was broken into individual features. */
  | { type: 'feature:broken'; featureId: string; count: number; undo: () => void }
  /** The current selection was copied to the internal clipboard. */
  | { type: 'selection:copied' }
  /** Features were pasted from the internal clipboard. */
  | { type: 'selection:pasted'; count: number }

  // ── History ──────────────────────────────────────────────────────────────
  | { type: 'undo' }
  | { type: 'redo' }

  // ── Generic notifications ─────────────────────────────────────────────────
  /**
   * A recoverable error the user should be aware of. `code` / `source` are the same as on the
   * {@link ElementEditorError} `onError` receives (which fires first; returning `false` from it
   * stops this event).
   */
  | { type: 'error'; code: ErrorCode; source: ErrorSource; message: string; description?: string }
  /** A non-blocking warning (e.g. converting a circle to a plain polygon). */
  | { type: 'warning'; message: string; description?: string }
  /** A positive confirmation (e.g. "Coordinate updated"). */
  | { type: 'success'; message: string; description?: string }

/**
 * `onError` handler. Called first for every runtime failure, also when `onEvent` is set and for
 * "quiet" failures that show no toast (a failed preview, the system clipboard, the search box).
 * Return nothing to keep the built-in handling, `false` to stop it (no toast, no `onEvent` error
 * event: you show it), or a string to show that text instead (e.g. a translation keyed on `code`).
 */
export type ElementEditorErrorHandler = (error: ElementEditorError) => void | false | string
