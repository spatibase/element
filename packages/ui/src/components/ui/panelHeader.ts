// Header icon buttons for every window and panel (floating windows, data
// table, Layers, feature form, GeoJSON inspector): p-[3px] box around a 16px icon (22px button),
// so all headers share one size and interaction. No display class, so callers
// add `flex`.
export const panelHeaderIconBtn = 'items-center justify-center flex-shrink-0 p-[3px] rounded-elm-control text-elm-text-secondary hover:bg-(--elm-surface-hover,var(--color-gray-100)) dark:hover:bg-(--elm-surface-hover,var(--color-gray-700)) active:scale-[0.95] disabled:text-elm-text-disabled disabled:hover:bg-transparent disabled:active:scale-100 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-elm-focus-ring'

// One height for the Layers header and the data-table toolbar: in the split layout they sit
// side by side, so their bottom borders must form one continuous line. border-box => the
// 1px border is inside the 40px. Callers add their own horizontal padding / colours.
export const panelHeaderBar = 'h-10 box-border flex items-center flex-shrink-0 border-b border-elm-border bg-elm-surface-sunken'
