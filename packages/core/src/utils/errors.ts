/**
 * What kind of failure an {@link ElementEditorError} is. Closed and semver-covered: a new code is a
 * minor release, renaming or removing one is a major. Branch on this, not on the message text.
 */
export type ErrorCode =
  /** A request failed: no connection, CORS, DNS, a non-retryable HTTP status, a lazy chunk that didn't load. */
  | 'network'
  /** The service answered 429 (too many requests). Worth retrying later. */
  | 'rate-limited'
  /** The service answered 502–504 (overloaded). Worth retrying later. */
  | 'busy'
  /** No answer in time (Overpass request, geometry worker). Worth retrying. */
  | 'timeout'
  /** The service refused the credentials (HTTP 401/403), e.g. a bad routing API key or style key. */
  | 'unauthorized'
  /** Input or a response that can't be read: invalid JSON, not a FeatureCollection, a broken style. */
  | 'invalid-data'
  /** A file over the import size cap. */
  | 'too-large'
  /** The `maxFeatures` limit refused (or truncated) an add. */
  | 'limit-reached'
  /** A geometry operation failed or produced an empty / unusable shape. */
  | 'geometry'
  /** The browser refused a permission (geolocation, clipboard, file save). */
  | 'permission-denied'
  /** The browser or the map lacks something needed (no geolocation API, no clipboard API, a style without glyphs). */
  | 'unsupported'
  /** The editor crashed while rendering; the error boundary shows its fallback. */
  | 'crash'
  /** Anything else. */
  | 'unknown'

/** Where an {@link ElementEditorError} came from. Closed and semver-covered like {@link ErrorCode}. */
export type ErrorSource =
  | 'basemap' | 'picker' | 'routing' | 'search' | 'import' | 'export'
  | 'clipboard' | 'geometry' | 'locate' | 'editor'

/**
 * A runtime failure, as passed to `onError`. `message` is honest English for a person (what
 * happened, what to do); `code` + `source` are for code (translation, own UI, logging).
 * It is an `Error`, so it has a stack and Sentry & co. take it as is.
 */
export class ElementEditorError extends Error {
  readonly code: ErrorCode
  readonly source: ErrorSource
  /** The feature the failed operation was about, when there was one. */
  readonly featureId?: string
  /** The underlying error (a `Response` status error, a `DOMException`, a worker error, …). */
  readonly cause?: unknown
  constructor(code: ErrorCode, source: ErrorSource, message: string, opts?: { cause?: unknown; featureId?: string }) {
    super(message)
    this.name = 'ElementEditorError'
    this.code = code
    this.source = source
    if (opts?.cause !== undefined) this.cause = opts.cause
    if (opts?.featureId !== undefined) this.featureId = opts.featureId
  }
}

/** The {@link ErrorCode} for a failed HTTP status. */
export function httpErrorCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  if (status === 502 || status === 503 || status === 504) return 'busy'
  return 'network'
}

/**
 * Best-guess {@link ErrorCode} for a failed load: an `ElementEditorError`'s own code, an HTTP
 * `status` (MapLibre's `AJAXError`), unreadable JSON, else `'network'`.
 */
export function loadErrorCode(err: unknown): ErrorCode {
  if (err instanceof ElementEditorError) return err.code
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status === 'number') return httpErrorCode(status)
  if (err instanceof SyntaxError) return 'invalid-data'
  return 'network'
}
