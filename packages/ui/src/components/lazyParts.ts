import { lazyWithPreload } from '../utils/lazyWithPreload'

// Heavy parts used INSIDE eager panels, split into their own chunks. They live
// here (not in index.ts) so the panels and the public exports share ONE lazy
// wrapper per module. Never also export these modules statically from the
// entry: a module the entry re-exports lands in the entry chunk, and every
// dynamic import() of it then resolves to that already-eager chunk.

/** The layers list (@hello-pangea/dnd + its redux, @tanstack/react-virtual). */
export const FeatureList = /*#__PURE__*/ lazyWithPreload(() => import('./sidebar/FeatureList'))
/** The data grid (react-data-grid). */
export const DataTable = /*#__PURE__*/ lazyWithPreload(() => import('./DataTable'))
/** Schema field editor (only ever shown in the schema window). */
export const SchemaEditor = /*#__PURE__*/ lazyWithPreload(() => import('./sidebar/SchemaEditor'))

