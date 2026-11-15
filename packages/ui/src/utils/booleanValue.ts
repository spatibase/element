/**
 * Boolean schema fields store real `true` / `false`. Data imported from elsewhere may carry them as
 * text ("true", "yes", "1") or numbers; these read such values the same way everywhere (feature
 * panel, data table, sorting) and turn pasted text into a boolean.
 */
const TRUE_TEXT = new Set(['true', 'yes', 'y', '1', 'on', 'x', '✓'])
const FALSE_TEXT = new Set(['false', 'no', 'n', '0', 'off', ''])

/** Text (typed or pasted) as a boolean, or `null` when it isn't one ("maybe"). */
export function parseBooleanText(text: string): boolean | null {
  const t = text.trim().toLowerCase()
  if (TRUE_TEXT.has(t)) return true
  if (FALSE_TEXT.has(t)) return false
  return null
}

/** Whether a stored boolean field value counts as on. Missing / unknown values are off. */
export function readBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return parseBooleanText(value) === true
  return false
}
