import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {Timeline411HtmlView} from '../src/timeline411/htmlView'
import {types} from '../src/timeline411/propTypes'
import {createTimeline, Timeline411} from '../src/timeline411/timeline'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('vista Timeline 411 HTML', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
    document.body.innerHTML = '<div id="timeline-test"></div>'
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('se monta en un selector, dibuja tracks y se desmonta limpiamente', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')

    const root = document.querySelector<HTMLElement>('[data-timeline411-view]')
    expect(root?.getAttribute('aria-label')).toBe('Timeline 411')
    expect(root?.textContent).toContain('Objetos y propiedades')
    expect(document.querySelectorAll('.k411-timeline-keyframe').length).toBeGreaterThan(6)
    expect(document.querySelector<HTMLElement>('.k411-timeline-shell')?.style.minWidth).toBe(
      '640px',
    )

    view.dispose()
    timeline.dispose()
    expect(document.querySelector('[data-timeline411-view]')).toBeNull()
  })

  it('muestra valores, bloquea interpolaciones y edita keyframes y estáticos', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')

    const xRow = findPropertyRow('x')
    expect(xRow.querySelector<HTMLInputElement>('.k411-timeline-value-editor')?.value).toBe(
      '0',
    )

    timeline.player.seek(1.5)
    expect(xRow.querySelector('.k411-timeline-value-editor')).toBeNull()
    expect(xRow.querySelector('.k411-timeline-value-output')).not.toBeNull()

    const lastXKeyframe = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 3.000s')
    expect(lastXKeyframe).toBeDefined()
    lastXKeyframe?.click()
    expect(timeline.player.position).toBe(3)

    const editableX = findPropertyRow('x').querySelector<HTMLInputElement>(
      '.k411-timeline-value-editor',
    )
    expect(editableX).not.toBeNull()
    if (!editableX) throw new Error('No se encontró el editor del keyframe')
    editableX.value = '1.23456'
    editableX.dispatchEvent(new Event('input', {bubbles: true}))
    editableX.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )

    const xTrack = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData.Q9IUK1iBde
    expect(xTrack?.keyframes[1].value).toBe(1.23456)
    expect(findPropertyRow('x').querySelector<HTMLInputElement>('input')?.value).toBe(
      '1.235',
    )

    const wireframe = findPropertyRow('wireframe').querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    expect(wireframe?.checked).toBe(true)
    if (!wireframe) throw new Error('No se encontró el editor de wireframe')
    wireframe.checked = false
    wireframe.dispatchEvent(new Event('input', {bubbles: true}))
    wireframe.dispatchEvent(new Event('change', {bubbles: true}))
    expect(
      timeline.document.sheetsById['Animated scene'].staticOverrides.byObject[
        'Torus Knot'
      ].wireframe,
    ).toBe(false)

    expect(timeline.store.undo()).toBe(true)
    expect(
      timeline.document.sheetsById['Animated scene'].staticOverrides.byObject[
        'Torus Knot'
      ].wireframe,
    ).toBe(true)
    view.dispose()
    timeline.dispose()
  })

  it('usa el schema para representar stringLiteral como selector', () => {
    const timeline = createTimeline({id: 'typed-view'})
    const composition = timeline.composition('Scene')
    const object = composition.object('Material', {
      mode: types.stringLiteral('solid', {
        solid: 'Sólido',
        wireframe: 'Alambre',
      }),
    })
    timeline.editor.transaction((transaction) => {
      transaction.set(object.props.mode, 'solid')
    })
    const view = new Timeline411HtmlView(timeline, 'Scene')
    view.mount('#timeline-test')

    const select = findPropertyRow('mode').querySelector<HTMLSelectElement>('select')
    expect(select?.value).toBe('solid')
    expect(select?.options[1].textContent).toBe('Alambre')
    if (!select) throw new Error('No se encontró el selector de mode')
    select.value = 'wireframe'
    select.dispatchEvent(new Event('input', {bubbles: true}))
    select.dispatchEvent(new Event('change', {bubbles: true}))
    expect(object.value.mode).toBe('wireframe')

    view.dispose()
    timeline.dispose()
  })
})

function findPropertyRow(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.k411-timeline-tree-row')].find(
    (candidate) =>
      candidate.querySelector('.k411-timeline-tree-row__label')?.textContent === label,
  )
  if (!row) throw new Error(`No se encontró la fila ${label}`)
  return row
}
