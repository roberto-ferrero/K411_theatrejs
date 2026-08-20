import type {PropertyPath, SerializableMap, SerializableValue} from './model'

export function encodePropertyPath(path: PropertyPath): string {
  return JSON.stringify(path)
}

export function decodePropertyPath(encoded: string): string[] {
  const parsed: unknown = JSON.parse(encoded)
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new Error(`Property path inválido: ${encoded}`)
  }
  return parsed
}

export function setValueAtPath(
  target: SerializableMap,
  path: PropertyPath,
  value: SerializableValue,
): void {
  if (path.length === 0) throw new Error('Un property path no puede estar vacío')

  let current = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index]
    const existing = current[part]
    if (!isSerializableMap(existing)) {
      current[part] = {}
    }
    current = current[part] as SerializableMap
  }
  current[path[path.length - 1]] = value
}

export function getValueAtPath(
  target: SerializableMap,
  path: PropertyPath,
): SerializableValue | undefined {
  let current: SerializableValue | undefined = target
  for (const part of path) {
    if (!isSerializableMap(current)) return undefined
    current = current[part]
    if (typeof current === 'undefined') return undefined
  }
  return current
}

export function unsetValueAtPath(
  target: SerializableMap,
  path: PropertyPath,
): boolean {
  if (path.length === 0) throw new Error('Un property path no puede estar vacío')

  const parents: Array<{map: SerializableMap; key: string}> = []
  let current = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const child = current[key]
    if (!isSerializableMap(child)) return false
    parents.push({map: current, key})
    current = child
  }

  const leaf = path[path.length - 1]
  if (!Object.prototype.hasOwnProperty.call(current, leaf)) return false
  delete current[leaf]

  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const {map, key} = parents[index]
    const child = map[key]
    if (!isSerializableMap(child) || Object.keys(child).length > 0) break
    delete map[key]
  }
  return true
}

export function isSerializableMap(
  value: SerializableValue | undefined,
): value is SerializableMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
