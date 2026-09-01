export interface NumberScrubOptions {
  readonly initialValue: number
  readonly deltaPixels: number
  readonly nudgeMultiplier?: number
  readonly range?: readonly [number, number]
  readonly fine?: boolean
  readonly coarse?: boolean
}

export function getNumberScrubStep(
  initialValue: number,
  options: Pick<NumberScrubOptions, 'nudgeMultiplier' | 'range'> = {},
): number {
  assertFinite(initialValue, 'El valor inicial')
  if (typeof options.nudgeMultiplier !== 'undefined') {
    assertPositive(options.nudgeMultiplier, 'nudgeMultiplier')
    return options.nudgeMultiplier
  }
  if (options.range) {
    assertRange(options.range)
    const span = options.range[1] - options.range[0]
    if (span > 0) return span / 200
  }
  return Math.max(1, Math.abs(initialValue)) * 0.01
}

export function calculateScrubbedNumber(options: NumberScrubOptions): number {
  assertFinite(options.deltaPixels, 'El desplazamiento')
  const step = getNumberScrubStep(options.initialValue, options)
  const modifier = options.fine ? 0.1 : options.coarse ? 10 : 1
  const candidate = options.initialValue + options.deltaPixels * step * modifier
  if (!Number.isFinite(candidate)) {
    throw new Error('El valor calculado por el scrubber no es finito')
  }
  if (!options.range) return candidate
  assertRange(options.range)
  return Math.max(options.range[0], Math.min(options.range[1], candidate))
}

function assertRange(range: readonly [number, number]): void {
  assertFinite(range[0], 'El mínimo del range')
  assertFinite(range[1], 'El máximo del range')
  if (range[0] > range[1]) throw new Error('El range del scrubber no es válido')
}

function assertPositive(value: number, label: string): void {
  assertFinite(value, label)
  if (value <= 0) throw new Error(`${label} debe ser mayor que cero`)
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} debe ser finito`)
}
