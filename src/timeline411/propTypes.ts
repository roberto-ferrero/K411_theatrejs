import type {PropertyPath, SerializableMap, SerializableValue} from './model'
import {encodePropertyPath} from './paths'

export interface RgbaValue extends SerializableMap {
  r: number
  g: number
  b: number
  a: number
}

export interface ImageValue extends SerializableMap {
  type: 'image'
  id?: string
}

export interface FileValue extends SerializableMap {
  type: 'file'
  id?: string
}

export type TimelineInterpolator<Value> = (
  left: Value,
  right: Value,
  progression: number,
) => Value

export type TimelinePropTypeName =
  | 'number'
  | 'boolean'
  | 'string'
  | 'stringLiteral'
  | 'rgba'
  | 'image'
  | 'file'
  | 'compound'

const propTypeMarker = Symbol('Timeline411PropType')

interface BasePropTypeConfig<Type extends TimelinePropTypeName, Value> {
  readonly [propTypeMarker]?: true
  readonly type: Type
  readonly default: Value
  readonly label?: string
  readonly sanitize: (input: unknown) => Value | undefined
}

export interface SimplePropTypeConfig<
  Type extends Exclude<TimelinePropTypeName, 'compound'>,
  Value,
> extends BasePropTypeConfig<Type, Value> {
  readonly interpolate: TimelineInterpolator<Value>
}

export interface NumberPropTypeConfig
  extends SimplePropTypeConfig<'number', number> {
  readonly range?: readonly [number, number]
  readonly nudgeMultiplier?: number
}

export interface BooleanPropTypeConfig
  extends SimplePropTypeConfig<'boolean', boolean> {}

export interface StringPropTypeConfig
  extends SimplePropTypeConfig<'string', string> {}

export interface StringLiteralPropTypeConfig<Value extends string = string>
  extends SimplePropTypeConfig<'stringLiteral', Value> {
  readonly valuesAndLabels: Readonly<Record<Value, string>>
  readonly as: 'menu' | 'switch'
}

export interface RgbaPropTypeConfig
  extends SimplePropTypeConfig<'rgba', RgbaValue> {}

export interface ImagePropTypeConfig
  extends SimplePropTypeConfig<'image', ImageValue> {}

export interface FilePropTypeConfig
  extends SimplePropTypeConfig<'file', FileValue> {}

export interface CompoundPropTypeConfig<
  Props extends NormalizedPropSchema = NormalizedPropSchema,
> extends BasePropTypeConfig<'compound', PropsValue<Props>> {
  readonly props: Props
}

export type TimelinePropTypeConfig =
  | NumberPropTypeConfig
  | BooleanPropTypeConfig
  | StringPropTypeConfig
  | StringLiteralPropTypeConfig
  | RgbaPropTypeConfig
  | ImagePropTypeConfig
  | FilePropTypeConfig
  | CompoundPropTypeConfig

export type TimelineShorthandProp =
  | number
  | boolean
  | string
  | TimelinePropTypeConfig
  | TimelineShorthandSchema

export interface TimelineShorthandSchema {
  readonly [key: string]: TimelineShorthandProp
}

export interface NormalizedPropSchema {
  readonly [key: string]: TimelinePropTypeConfig
}

export type PropValue<Prop> = Prop extends BasePropTypeConfig<
  TimelinePropTypeName,
  infer Value
>
  ? Value
  : Prop extends number
    ? number
    : Prop extends boolean
      ? boolean
      : Prop extends string
        ? string
        : Prop extends TimelineShorthandSchema
          ? PropsValue<Prop>
          : never

export type PropsValue<Props> = {
  readonly [Key in keyof Props]: PropValue<Props[Key]>
}

export type NormalizedSchemaFor<Props extends TimelineShorthandSchema> = {
  readonly [Key in keyof Props]: NormalizeProp<Props[Key]>
}

type NormalizeProp<Prop> = Prop extends TimelinePropTypeConfig
  ? Prop
  : Prop extends number
    ? NumberPropTypeConfig
    : Prop extends boolean
      ? BooleanPropTypeConfig
      : Prop extends string
        ? StringPropTypeConfig
        : Prop extends TimelineShorthandSchema
          ? CompoundPropTypeConfig<NormalizedSchemaFor<Prop>>
          : never

interface CommonOptions<Value> {
  readonly label?: string
  readonly interpolate?: TimelineInterpolator<Value>
}

export const timelineTypes = {
  number(
    defaultValue: number,
    options: {
      readonly label?: string
      readonly range?: readonly [number, number]
      readonly nudgeMultiplier?: number
    } = {},
  ): NumberPropTypeConfig {
    if (!Number.isFinite(defaultValue)) {
      throw new Error('El valor por defecto de number debe ser finito')
    }
    if (
      options.range &&
      (!Number.isFinite(options.range[0]) ||
        !Number.isFinite(options.range[1]) ||
        options.range[0] > options.range[1])
    ) {
      throw new Error('El range de number no es válido')
    }
    return markConfig({
      type: 'number',
      default: defaultValue,
      label: options.label,
      range: options.range,
      nudgeMultiplier: options.nudgeMultiplier,
      sanitize: finiteNumber,
      interpolate: (left, right, progression) =>
        left + (right - left) * progression,
    })
  },

  boolean(
    defaultValue: boolean,
    options: CommonOptions<boolean> = {},
  ): BooleanPropTypeConfig {
    return markConfig({
      type: 'boolean',
      default: defaultValue,
      label: options.label,
      sanitize: (input) => (typeof input === 'boolean' ? input : undefined),
      interpolate: options.interpolate ?? discreteInterpolator,
    })
  },

  string(
    defaultValue: string,
    options: CommonOptions<string> = {},
  ): StringPropTypeConfig {
    return markConfig({
      type: 'string',
      default: defaultValue,
      label: options.label,
      sanitize: (input) => (typeof input === 'string' ? input : undefined),
      interpolate: options.interpolate ?? discreteInterpolator,
    })
  },

  stringLiteral<ValuesAndLabels extends Record<string, string>>(
    defaultValue: Extract<keyof ValuesAndLabels, string>,
    valuesAndLabels: ValuesAndLabels,
    options: {
      readonly as?: 'menu' | 'switch'
      readonly label?: string
      readonly interpolate?: TimelineInterpolator<
        Extract<keyof ValuesAndLabels, string>
      >
    } = {},
  ): StringLiteralPropTypeConfig<Extract<keyof ValuesAndLabels, string>> {
    if (!Object.prototype.hasOwnProperty.call(valuesAndLabels, defaultValue)) {
      throw new Error('El valor por defecto no existe en valuesAndLabels')
    }
    type Value = Extract<keyof ValuesAndLabels, string>
    return markConfig({
      type: 'stringLiteral',
      default: defaultValue,
      label: options.label,
      valuesAndLabels,
      as: options.as ?? 'menu',
      sanitize: (input) =>
        typeof input === 'string' &&
        Object.prototype.hasOwnProperty.call(valuesAndLabels, input)
          ? (input as Value)
          : undefined,
      interpolate: options.interpolate ?? discreteInterpolator<Value>,
    })
  },

  rgba(
    defaultValue: RgbaValue = {r: 0, g: 0, b: 0, a: 1},
    options: CommonOptions<RgbaValue> = {},
  ): RgbaPropTypeConfig {
    const sanitizedDefault = sanitizeRgba(defaultValue)
    if (!sanitizedDefault) throw new Error('El valor RGBA por defecto no es válido')
    return markConfig({
      type: 'rgba',
      default: sanitizedDefault,
      label: options.label,
      sanitize: sanitizeRgba,
      interpolate:
        options.interpolate ??
        ((left, right, progression) => ({
          r: left.r + (right.r - left.r) * progression,
          g: left.g + (right.g - left.g) * progression,
          b: left.b + (right.b - left.b) * progression,
          a: left.a + (right.a - left.a) * progression,
        })),
    })
  },

  image(
    defaultValue?: string,
    options: CommonOptions<string | undefined> = {},
  ): ImagePropTypeConfig {
    const interpolateId =
      options.interpolate ?? discreteInterpolator<string | undefined>
    return markConfig({
      type: 'image',
      default: {type: 'image', id: defaultValue},
      label: options.label,
      sanitize: (input) => sanitizeAsset(input, 'image'),
      interpolate: (left, right, progression) => ({
        type: 'image',
        id: interpolateId(left.id, right.id, progression),
      }),
    })
  },

  file(
    defaultValue?: string,
    options: CommonOptions<string | undefined> = {},
  ): FilePropTypeConfig {
    const interpolateId =
      options.interpolate ?? discreteInterpolator<string | undefined>
    return markConfig({
      type: 'file',
      default: {type: 'file', id: defaultValue},
      label: options.label,
      sanitize: (input) => sanitizeAsset(input, 'file'),
      interpolate: (left, right, progression) => ({
        type: 'file',
        id: interpolateId(left.id, right.id, progression),
      }),
    })
  },

  compound<Props extends TimelineShorthandSchema>(
    props: Props,
    options: {readonly label?: string} = {},
  ): CompoundPropTypeConfig<NormalizedSchemaFor<Props>> {
    const normalized = normalizePropSchema(props)
    return markConfig({
      type: 'compound',
      props: normalized,
      default: defaultValueFromSchema(normalized) as PropsValue<
        NormalizedSchemaFor<Props>
      >,
      label: options.label,
      sanitize: (input) => sanitizeCompound(normalized, input) as
        | PropsValue<NormalizedSchemaFor<Props>>
        | undefined,
    })
  },
}

export const types = timelineTypes

export function normalizePropSchema<Props extends TimelineShorthandSchema>(
  schema: Props,
): NormalizedSchemaFor<Props> {
  if (!isPlainObject(schema)) throw new Error('El schema de props debe ser un objeto')
  const normalized: Record<string, TimelinePropTypeConfig> = {}
  for (const [key, prop] of Object.entries(schema)) {
    if (key.length === 0) throw new Error('Una prop no puede tener un nombre vacío')
    normalized[key] = normalizeProp(prop)
  }
  return normalized as NormalizedSchemaFor<Props>
}

export function defaultValueFromSchema(
  schema: NormalizedPropSchema,
): SerializableMap {
  const result: SerializableMap = {}
  for (const [key, config] of Object.entries(schema)) {
    result[key] = clonePropValue(config.default) as SerializableValue
  }
  return result
}

export function sanitizeValueWithSchema(
  schema: NormalizedPropSchema,
  input: unknown,
): SerializableMap {
  return sanitizeCompound(schema, input) ?? defaultValueFromSchema(schema)
}

export function interpolatorsFromSchema(
  schema: NormalizedPropSchema,
): Readonly<
  Record<
    string,
    (
      left: SerializableValue,
      right: SerializableValue,
      progression: number,
    ) => SerializableValue
  >
> {
  const result: Record<
    string,
    (
      left: SerializableValue,
      right: SerializableValue,
      progression: number,
    ) => SerializableValue
  > = {}
  for (const {path, config} of flattenPropSchema(schema)) {
    result[encodePropertyPath(path)] = (left, right, progression) => {
      const sanitizedLeft = config.sanitize(left)
      const sanitizedRight = config.sanitize(right)
      if (
        typeof sanitizedLeft === 'undefined' ||
        typeof sanitizedRight === 'undefined'
      ) {
        return progression < 1 ? left : right
      }
      return config.interpolate(
        sanitizedLeft as never,
        sanitizedRight as never,
        progression,
      ) as SerializableValue
    }
  }
  return result
}

export interface FlattenedPropConfig {
  readonly path: PropertyPath
  readonly config: Exclude<TimelinePropTypeConfig, CompoundPropTypeConfig>
}

export function flattenPropSchema(
  schema: NormalizedPropSchema,
  prefix: readonly string[] = [],
): readonly FlattenedPropConfig[] {
  const result: FlattenedPropConfig[] = []
  for (const [key, config] of Object.entries(schema)) {
    const path = [...prefix, key]
    if (config.type === 'compound') {
      result.push(...flattenPropSchema(config.props, path))
    } else {
      result.push({path, config})
    }
  }
  return result
}

export function schemasAreCompatible(
  left: NormalizedPropSchema,
  right: NormalizedPropSchema,
): boolean {
  const byPath = (entry: FlattenedPropConfig): string =>
    encodePropertyPath(entry.path)
  const leftEntries = [...flattenPropSchema(left)].sort((a, b) =>
    byPath(a).localeCompare(byPath(b)),
  )
  const rightEntries = [...flattenPropSchema(right)].sort((a, b) =>
    byPath(a).localeCompare(byPath(b)),
  )
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every((entry, index) => {
    const other = rightEntries[index]
    return (
      entry.config.type === other.config.type &&
      JSON.stringify(entry.path) === JSON.stringify(other.path)
    )
  })
}

export function isPropTypeConfig(
  value: unknown,
): value is TimelinePropTypeConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<TimelinePropTypeConfig>)[propTypeMarker] === true
  )
}

function normalizeProp(prop: TimelineShorthandProp): TimelinePropTypeConfig {
  if (isPropTypeConfig(prop)) return prop
  if (typeof prop === 'number') return timelineTypes.number(prop)
  if (typeof prop === 'boolean') return timelineTypes.boolean(prop)
  if (typeof prop === 'string') return timelineTypes.string(prop)
  if (isPlainObject(prop)) return timelineTypes.compound(prop)
  throw new Error('Tipo de prop no soportado por Timeline 411')
}

function sanitizeCompound(
  schema: NormalizedPropSchema,
  input: unknown,
): SerializableMap | undefined {
  if (!isPlainObject(input)) return undefined
  const result: SerializableMap = {}
  for (const [key, config] of Object.entries(schema)) {
    const sanitized = config.sanitize(input[key])
    result[key] = clonePropValue(
      typeof sanitized === 'undefined' ? config.default : sanitized,
    ) as SerializableValue
  }
  return result
}

function sanitizeRgba(input: unknown): RgbaValue | undefined {
  if (!isPlainObject(input)) return undefined
  const r = finiteNumber(input.r)
  const g = finiteNumber(input.g)
  const b = finiteNumber(input.b)
  const a = finiteNumber(input.a)
  if (
    typeof r === 'undefined' ||
    typeof g === 'undefined' ||
    typeof b === 'undefined' ||
    typeof a === 'undefined'
  ) {
    return undefined
  }
  return {r, g, b, a}
}

function sanitizeAsset<Type extends 'image' | 'file'>(
  input: unknown,
  type: Type,
): Type extends 'image' ? ImageValue | undefined : FileValue | undefined {
  const result =
    isPlainObject(input) &&
    input.type === type &&
    (typeof input.id === 'undefined' || typeof input.id === 'string')
      ? {type, id: input.id as string | undefined}
      : undefined
  return result as Type extends 'image'
    ? ImageValue | undefined
    : FileValue | undefined
}

function finiteNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function discreteInterpolator<Value>(
  left: Value,
  right: Value,
  progression: number,
): Value {
  return progression < 1 ? left : right
}

function markConfig<Config extends object>(
  config: Config,
): Config & {[propTypeMarker]: true} {
  Object.defineProperty(config, propTypeMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return config as Config & {[propTypeMarker]: true}
}

function clonePropValue<Value>(value: Value): Value {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as Value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
