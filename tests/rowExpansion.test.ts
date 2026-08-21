import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {buildTimelineRows} from '../src/timeline411/projection'
import {
  filterVisibleTimelineRows,
  TimelineRowExpansionState,
} from '../src/timeline411/rowExpansion'
import {parseTheatreProjectState} from '../src/timeline411/validation'

const rows = buildTimelineRows(
  parseTheatreProjectState(projectState),
  'Animated scene',
)
const objectRow = rows.find(({kind}) => kind === 'object')!
const rotationRow = rows.find(({path}) => path.join('.') === 'rotation')!

describe('estado renderer-neutral de filas plegadas', () => {
  it('oculta descendientes de grupos y objetos conservando la fila padre', () => {
    const expansion = new TimelineRowExpansionState()
    expansion.collapse(rotationRow.id)
    expect(
      filterVisibleTimelineRows(rows, expansion).map(({label}) => label),
    ).toEqual(['Torus Knot', 'rotation', 'wireframe'])

    expansion.collapse(objectRow.id)
    expect(
      filterVisibleTimelineRows(rows, expansion).map(({label}) => label),
    ).toEqual(['Torus Knot'])
  })

  it('restaura el estado anidado cuando se vuelve a desplegar el objeto', () => {
    const expansion = new TimelineRowExpansionState()
    expansion.collapse(rotationRow.id)
    expansion.collapse(objectRow.id)
    expansion.expand(objectRow.id)

    expect(expansion.isCollapsed(rotationRow.id)).toBe(true)
    expect(
      filterVisibleTimelineRows(rows, expansion).map(({label}) => label),
    ).toEqual(['Torus Knot', 'rotation', 'wireframe'])
  })

  it('expone copias, limpia IDs obsoletos y mantiene instancias independientes', () => {
    const first = new TimelineRowExpansionState()
    const second = new TimelineRowExpansionState()
    first.collapse(rotationRow.id)
    first.collapse('fila-eliminada')

    expect(first.retain([objectRow.id, rotationRow.id])).toBe(true)
    expect(first.snapshot.collapsedRowIds).toEqual([rotationRow.id])
    expect(second.snapshot.collapsedRowIds).toEqual([])
    expect(first.clear()).toBe(true)
    expect(first.snapshot.collapsedRowIds).toEqual([])
  })
})
