/**
 * Coalesces high-frequency calls (mousemove, marker drag) into one call per
 * animation frame, always with the latest arguments. `flush()` runs a pending
 * call synchronously (call it before committing on mouseup so the commit sees
 * the final cursor position); `cancel()` drops it.
 */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let frame = 0
  let pending: A | null = null
  const run = () => {
    frame = 0
    const args = pending
    pending = null
    if (args) fn(...args)
  }
  return {
    schedule(...args: A) {
      pending = args
      if (!frame) frame = requestAnimationFrame(run)
    },
    flush() {
      if (frame) cancelAnimationFrame(frame)
      run()
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      pending = null
    },
  }
}
