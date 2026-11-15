/** Apple keyboard (⌘ instead of Ctrl). False on the server, where there is no navigator. */
export const isMacPlatform = (): boolean => typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
