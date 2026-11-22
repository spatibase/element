/**
 * Host markup using the same utility class names as Element's own UI. Rendered on the editor page
 * (index.html, next to <ElementEditor />) and alone on host.html, which loads only the host's CSS.
 * `pnpm check:examples --smoke` compares the computed styles of this subtree on both pages: Element's
 * stylesheet must not change a single host element.
 */
export function HostProbe() {
  return (
    <div id="host-probe" style={{ position: 'relative', width: 800, height: 240, overflow: 'hidden' }}>
      <nav className="hidden md:flex items-center justify-between gap-2 px-4 py-1 border-b border-gray-200">
        <a className="text-sm font-medium text-gray-700 truncate" href="#">Home</a>
        <button className="inline-flex rounded-md bg-white px-2 py-1 shadow cursor-pointer select-none">Menu</button>
      </nav>
      <div className="md:hidden block">mobile only</div>
      <div className="relative h-24 w-full">
        <div className="absolute inset-0 z-10 opacity-50 bg-gray-100" />
        <div className="absolute top-0 right-0 h-4 w-4 rounded-full" />
        <span className="sr-only">screen reader text</span>
      </div>
      <div className="flex flex-col items-center space-y-2 p-2 m-2 mt-1">
        <p className="text-xs leading-tight">One</p>
        <p className="font-semibold">Two</p>
      </div>
      <div className="grid grid-cols-2 gap-1 min-w-0 max-w-xs overflow-hidden">
        <span className="invisible">invisible</span>
        <span className="collapse">collapse</span>
      </div>
      <div className="fixed top-0 left-0 z-50 hidden">fixed, hidden</div>
      <div className="sticky top-0 container transition-colors ring-2 outline-none" />
      <div className="translate-x-1 scale-95 rotate-45 border rounded shadow-lg" />
      <h1>Host heading</h1>
      <svg width="10" height="10" />
      <input className="w-full" />
    </div>
  )
}
