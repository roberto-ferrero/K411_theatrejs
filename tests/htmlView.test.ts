import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {Timeline411HtmlView} from '../src/timeline411/htmlView'
import {Timeline411} from '../src/timeline411/timeline'

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
})
