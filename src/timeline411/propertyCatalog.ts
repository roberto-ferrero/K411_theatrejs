import type {PropertyPath, SerializableValue, TimelineDocument} from './model'
import type {TimelineObject, TimelinePropertyRef} from './objectApi'
import {encodePropertyPath, getValueAtPath} from './paths'

export interface TimelinePropertyCatalogDefinition {
  readonly id?: string
  readonly path: PropertyPath
  readonly label?: string
  readonly category?: string
  /** Lee el valor vigente del objeto anfitrión al activar la layer. */
  readonly read?: () => unknown
}

export interface TimelineObjectPropertyCatalogConfig {
  readonly objectType: string
  readonly properties: readonly TimelinePropertyCatalogDefinition[]
}

export interface TimelinePropertyCatalogEntry {
  readonly id: string
  readonly path: PropertyPath
  readonly label: string
  readonly category: string
  readonly property: TimelinePropertyRef
}

interface RegisteredEntry extends TimelinePropertyCatalogEntry {
  readonly read?: () => unknown
}

const catalogs = new WeakMap<TimelineObject, TimelineObjectPropertyCatalog>()

/** Catálogo de props animables proporcionado por la integración anfitriona. */
export class TimelineObjectPropertyCatalog {
  readonly objectType: string
  private readonly registeredEntries: readonly RegisteredEntry[]

  constructor(
    readonly object: TimelineObject,
    config: TimelineObjectPropertyCatalogConfig,
  ) {
    if (config.objectType.trim() === '') {
      throw new Error('El tipo del catálogo de propiedades no puede estar vacío')
    }
    this.objectType = config.objectType
    const ids = new Set<string>()
    const paths = new Set<string>()
    this.registeredEntries = config.properties.map((definition) => {
      if (definition.path.length === 0) {
        throw new Error('Una propiedad disponible necesita un path')
      }
      const property = object.getProperty(definition.path)
      if (!property) {
        throw new Error(
          `La propiedad ${definition.path.join('.')} no existe en el schema de ${object.id}`,
        )
      }
      const encodedPath = encodePropertyPath(definition.path)
      const id = definition.id ?? encodedPath
      if (ids.has(id)) throw new Error(`ID de propiedad duplicado: ${id}`)
      if (paths.has(encodedPath)) {
        throw new Error(`Property path duplicado: ${encodedPath}`)
      }
      ids.add(id)
      paths.add(encodedPath)
      return {
        id,
        path: [...definition.path],
        label:
          definition.label ??
          property.config.label ??
          definition.path[definition.path.length - 1],
        category: definition.category ?? 'Propiedades',
        property,
        read: definition.read,
      }
    })
  }

  get entries(): readonly TimelinePropertyCatalogEntry[] {
    return this.registeredEntries.map(({read: _read, ...entry}) => ({
      ...entry,
      path: [...entry.path],
    }))
  }

  getAvailableEntries(
    document: TimelineDocument = this.object.composition.timeline.document,
  ): readonly TimelinePropertyCatalogEntry[] {
    return this.entries.filter(
      ({property}) => !isTimelinePropertyActive(document, property),
    )
  }

  activate(entryId: string): boolean {
    const entry = this.registeredEntries.find(({id}) => id === entryId)
    if (!entry) throw new Error(`Propiedad desconocida en el catálogo: ${entryId}`)
    const timeline = this.object.composition.timeline
    if (isTimelinePropertyActive(timeline.document, entry.property)) return false
    const rawValue = entry.read ? entry.read() : entry.property.get()
    const value = entry.property.config.sanitize(rawValue)
    if (typeof value === 'undefined') {
      throw new Error(`Valor inválido al activar ${entry.path.join('.')}`)
    }
    timeline.editor.transaction(
      (transaction) => transaction.set(
        entry.property as TimelinePropertyRef<SerializableValue>,
        value as SerializableValue,
      ),
      {label: `Añadir propiedad ${entry.label}`},
    )
    return true
  }
}

export function registerTimelineObjectPropertyCatalog(
  object: TimelineObject,
  config: TimelineObjectPropertyCatalogConfig,
): TimelineObjectPropertyCatalog {
  const catalog = new TimelineObjectPropertyCatalog(object, config)
  catalogs.set(object, catalog)
  object.composition.timeline.notifyObjectConfigurationChanged(
    object.composition.id,
    object.id,
  )
  return catalog
}

export function getTimelineObjectPropertyCatalog(
  object: TimelineObject | undefined,
): TimelineObjectPropertyCatalog | undefined {
  return object ? catalogs.get(object) : undefined
}

export function unregisterTimelineObjectPropertyCatalog(
  object: TimelineObject,
): boolean {
  const removed = catalogs.delete(object)
  if (removed) {
    object.composition.timeline.notifyObjectConfigurationChanged(
      object.composition.id,
      object.id,
    )
  }
  return removed
}

export function isTimelinePropertyActive(
  document: TimelineDocument,
  property: TimelinePropertyRef,
): boolean {
  const sheet = document.sheetsById[property.object.composition.id]
  const staticValues = sheet?.staticOverrides.byObject[property.object.id] ?? {}
  const objectTracks = sheet?.sequence?.tracksByObject[property.object.id]
  return property.getLeafRefs().some((leaf) =>
    typeof getValueAtPath(staticValues, leaf.path) !== 'undefined' ||
    Boolean(objectTracks?.trackIdByPropPath[encodePropertyPath(leaf.path)]),
  )
}
