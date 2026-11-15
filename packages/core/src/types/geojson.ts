/** A named folder of features in the layers panel. Features point to it with `groupId`. */
export interface Group {
  /** Unique id; features reference it in `groupId`. */
  id: string
  /** Name shown in the layers panel. */
  name: string
  /** Folded in the layers panel. */
  collapsed: boolean
  /** Hides every feature of the group on the map (they stay in the data). */
  hidden?: boolean
}

/** The input a schema field renders in the feature panel and the data table. */
export type FieldType = 'text' | 'textarea' | 'number' | 'url' | 'select' | 'date' | 'boolean'

/**
 * One property of a {@link Schema}: how the feature panel and the data table edit
 * `feature.properties[key]`, and how it is validated.
 *
 * @example { key: 'status', label: 'Status', type: 'select', required: true, options: ['planned', 'done'] }
 */
export interface SchemaField {
  /** Property key in `feature.properties`. The schema editor derives it from the label (a slug); set your own when you define schemas in code. */
  key: string
  /** Label shown in the feature panel and as the data table's column header. */
  label: string
  /** Input type. */
  type: FieldType
  /**
   * An empty value (missing, `null` or blank text) is a validation error: `ref.validate()` and
   * `ref.submit()` report it. It never blocks editing.
   */
  required: boolean
  /** Choices of a `'select'` field. Ignored for other types. */
  options?: string[]
  /** Smallest allowed value of a `'number'` field (a validation error below it). */
  min?: number
  /** Largest allowed value of a `'number'` field (a validation error above it). */
  max?: number
}

/**
 * A named set of fields for feature properties. A feature follows the schema its `schemaId` names
 * (none: the first schema). Several schemas can coexist (e.g. "Parcel" and "Building"); they travel
 * with the data as `metadata.schemas`. Removing a field never deletes values already stored.
 *
 * @example
 * const parcel: Schema = {
 *   id: 'parcel',
 *   name: 'Parcel',
 *   fields: [
 *     { key: 'owner', label: 'Owner', type: 'text', required: true },
 *     { key: 'area_ha', label: 'Area (ha)', type: 'number', required: false, min: 0 },
 *   ],
 * }
 */
export interface Schema {
  /** Unique id; features reference it in `schemaId`. */
  id: string
  /** Name shown in the schema editor and the feature panel. */
  name: string
  /** The fields, in display order. */
  fields: SchemaField[]
}

export type EditingMode = 'none' | 'place-point' | 'draw-line' | 'draw-polygon' | 'draw-circle' | 'draw-rect' | 'draw-route' | 'draw-freehand' | 'pick-shape'
  | 'cut-hole' | 'slice-shape' | 'simplify-shape' | 'smooth-shape' | 'buffer-shape' | 'measure'

export interface PointGeometry {
  type: 'Point'
  coordinates: [number, number] // [longitude, latitude]
}

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][] // [[lng, lat], ...]
}

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: [number, number][][] // [outer ring, ...optional holes]
}

export interface MultiPointGeometry {
  type: 'MultiPoint'
  coordinates: [number, number][] // array of points
}

export interface MultiLineStringGeometry {
  type: 'MultiLineString'
  coordinates: [number, number][][] // array of line strings
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: [number, number][][][] // array of polygons, each polygon is [outer ring, ...optional holes]
}

export type SimpleGeometry = PointGeometry | MultiPointGeometry | LineStringGeometry | MultiLineStringGeometry | PolygonGeometry | MultiPolygonGeometry

export interface GeometryCollectionGeometry {
  type: 'GeometryCollection'
  geometries: SimpleGeometry[]
  /** @internal Not present on GeometryCollection — exists for union type compatibility. */
  coordinates?: never
}

export type Geometry = SimpleGeometry | GeometryCollectionGeometry

/**
 * Helper type: a Geometry that is NOT GeometryCollection, i.e. it always has `coordinates`.
 * Use when a function only handles simple geometries (Point, Line, Polygon and their Multi variants).
 */
export type CoordinateGeometry = SimpleGeometry

/** Type guard: narrows Geometry to SimpleGeometry (has .coordinates). */
export function isSimpleGeometry(g: Geometry): g is SimpleGeometry {
  return g.type !== 'GeometryCollection'
}

/**
 * Cast a Geometry to SimpleGeometry for coordinate access.
 * Use in components that already know the geometry type (e.g., POIMarker only receives Points).
 * Throws at runtime if called with a GeometryCollection.
 */
export function asSimple(g: Geometry): SimpleGeometry {
  if (g.type === 'GeometryCollection') throw new Error('Expected simple geometry, got GeometryCollection')
  return g
}

export type DrawType = 'circle' | 'rectangle' | 'route'

/**
 * A feature as Element hands it back (`getFeatureCollection`, `onChange`, `onFeature*`, events):
 * RFC 7946 GeoJSON with a string `id`, an object `properties` and a few Element foreign members
 * (RFC 7946 §6.1). Keep those members when you store features: they survive a round-trip through
 * `initialData` / `setFeatureCollection`. What Element accepts is the looser
 * {@link GeoJSONFeatureInput}.
 */
export interface GeoJSONFeature {
  type: 'Feature'
  /** Always a string: a UUID for features Element created, numeric input ids as strings. */
  id: string
  /** Id of the {@link Schema} its properties follow. Missing: the first schema. */
  schemaId?: string
  /** Id of the {@link Group} it belongs to in the layers panel. Missing: ungrouped. */
  groupId?: string
  /** `true`: hidden on the map (still in the data, the layers list and the table). */
  hidden?: boolean
  /** The tool that drew it (`'circle'`, `'rectangle'`, `'route'`); a point edit or geometry operation makes the shape plain and removes it. Don't strip it when you store features. */
  _drawType?: DrawType
  /** `[west, south, east, north]`, computed by Element from the geometry (RFC 7946 §5). */
  bbox?: [number, number, number, number]
  /**
   * Validation state the editor keeps on its stored features; stripped from everything Element hands
   * back (`onChange`, `getFeatureCollection()`, exports). Not part of the public data shape: use
   * `ref.validate()` / `validateFeature()`, and never write it.
   * @internal
   */
  _validation?: { errors: string[]; warnings: string[] }
  /** Coordinates are `[lng, lat]` (GeoJSON order). */
  geometry: Geometry
  /** The feature's attributes; schema fields read and write `properties[field.key]`. */
  properties: Record<string, unknown>
}

/**
 * The data as Element hands it back (`onChange`, `onSubmit`, `getFeatureCollection`): every
 * feature plus `metadata` (schemas and groups, an RFC 7946 §6.1 foreign member), so a round-trip
 * through your backend keeps them. Pass it back as `initialData` or to `setFeatureCollection`.
 * What Element accepts is the looser {@link FeatureCollectionInput} (any RFC 7946 collection).
 */
export interface FeatureCollection {
  type: 'FeatureCollection'
  /** Element's schemas and groups. Always present on collections Element produces. */
  metadata: {
    schemas: Schema[]
    groups: Group[]
  }
  features: GeoJSONFeature[]
}

/**
 * A GeoJSON position as Element accepts it: `[lng, lat]`, optionally followed by an altitude (and
 * further values). Extra values are kept as given; a vertex the user moves becomes `[lng, lat]`.
 */
export type PositionInput = number[]

/** A bounding box as RFC 7946 allows it: 2D `[west, south, east, north]` or 3D (6 values). Element recomputes its own. */
export type BBoxInput = [number, number, number, number] | [number, number, number, number, number, number]

/**
 * A geometry as Element accepts it: any RFC 7946 geometry, including `GeometryCollection` and 3D
 * positions. `@types/geojson`'s `Geometry` is assignable to it.
 */
export type GeometryInput =
  | { type: 'Point'; coordinates: PositionInput; bbox?: BBoxInput | undefined }
  | { type: 'MultiPoint'; coordinates: PositionInput[]; bbox?: BBoxInput | undefined }
  | { type: 'LineString'; coordinates: PositionInput[]; bbox?: BBoxInput | undefined }
  | { type: 'MultiLineString'; coordinates: PositionInput[][]; bbox?: BBoxInput | undefined }
  | { type: 'Polygon'; coordinates: PositionInput[][]; bbox?: BBoxInput | undefined }
  | { type: 'MultiPolygon'; coordinates: PositionInput[][][]; bbox?: BBoxInput | undefined }
  | { type: 'GeometryCollection'; geometries: GeometryInput[]; bbox?: BBoxInput | undefined }

/**
 * A feature as Element accepts it (`initialData`, `addFeature`, `importGeoJSON`,
 * `setFeatureCollection`): any RFC 7946 feature, so `@types/geojson`'s `Feature` type-checks as is.
 *
 * - `id` is optional: string or number (a missing one gets a UUID, a number becomes a string).
 * - `properties` may be `null` or missing (stored as `{}`).
 * - `geometry: null` (an unlocated feature) type-checks, but Element can't show it: such features
 *   are skipped on import and reported through `onError` / the `error` event (`code:
 *   'invalid-data'`, `source: 'import'`); `addFeature` returns `null` for one.
 * - `bbox` may be 2D or 3D; Element recomputes it.
 *
 * What Element hands back (`getFeatureCollection`, `onChange`, events) is always a {@link GeoJSONFeature}.
 */
export interface GeoJSONFeatureInput {
  type: 'Feature'
  id?: string | number | undefined
  geometry: GeometryInput | null
  properties?: Record<string, unknown> | null | undefined
  bbox?: BBoxInput | undefined
  /** See `GeoJSONFeature.schemaId`. */
  schemaId?: string | undefined
  /** See `GeoJSONFeature.groupId`. */
  groupId?: string | undefined
  /** See `GeoJSONFeature.hidden`. */
  hidden?: boolean | undefined
  /** See `GeoJSONFeature._drawType`. */
  _drawType?: DrawType | undefined
}

/**
 * A FeatureCollection as Element accepts it: any RFC 7946 collection, so `@types/geojson`'s
 * `FeatureCollection` type-checks as is. `metadata` (Element's schemas and groups) is optional, and
 * so is each part of it (no schemas: the default schema); features are {@link GeoJSONFeatureInput}s.
 *
 * @example
 * const fc: GeoJSON.FeatureCollection = await (await fetch('/parcels.geojson')).json()
 * ref.current?.setFeatureCollection(fc)
 */
export interface FeatureCollectionInput {
  type: 'FeatureCollection'
  /** Element's schemas and groups, as `FeatureCollection.metadata` carries them. */
  metadata?: {
    schemas?: Schema[]
    groups?: Group[]
  }
  features: GeoJSONFeatureInput[]
  bbox?: BBoxInput | undefined
}
