const epsilon = 1e-7

function cubicCoordinate(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return (
    3 * inverse * inverse * t * first +
    3 * inverse * t * t * second +
    t * t * t
  )
}

export function solveCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const clamped = Math.max(0, Math.min(1, progress))
  let low = 0
  let high = 1
  let parameter = clamped

  for (let iteration = 0; iteration < 24; iteration += 1) {
    parameter = (low + high) / 2
    const x = cubicCoordinate(parameter, x1, x2)
    if (Math.abs(x - clamped) <= epsilon) break
    if (x < clamped) low = parameter
    else high = parameter
  }

  return cubicCoordinate(parameter, y1, y2)
}
