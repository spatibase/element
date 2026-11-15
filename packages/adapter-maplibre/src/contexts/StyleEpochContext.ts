import { createContext, useContext } from 'react'

/**
 * Bumped each time Element (re)created its `elm-*` sources on the map's current style: the first
 * init and every repair after a `map.setStyle`. Effects that push data into an `elm-*` source list
 * it as a dependency, so they refill the new, empty sources.
 */
export const StyleEpochContext = createContext(0)
export const useStyleEpoch = (): number => useContext(StyleEpochContext)
