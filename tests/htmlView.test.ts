import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {Timeline411HtmlView} from '../src/timeline411/htmlView'
import {registerTimelineObjectPropertyCatalog} from '../src/timeline411/propertyCatalog'
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

  it('pliega objetos y grupos conservando el estado anidado fuera del JSON', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    const documentBefore = timeline.stringify()
    view.mount('#timeline-test')

    const visibleLabels = () =>
      [...document.querySelectorAll<HTMLElement>(
        '.k411-timeline-tree-row__label',
      )].map((label) => label.textContent)
    const disclosure = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(
        '.k411-timeline-tree-row__disclosure',
      )].find((button) => button.getAttribute('aria-label') === label)

    expect(visibleLabels()).toEqual([
      'Torus Knot',
      'rotation',
      'x',
      'y',
      'z',
      'wireframe',
    ])
    expect(document.querySelectorAll('.k411-timeline-lane')).toHaveLength(6)
    expect(
      findPropertyRow('wireframe').querySelector(
        '.k411-timeline-tree-row__disclosure',
      ),
    ).toBeNull()

    disclosure('Colapsar grupo rotation')?.click()
    expect(visibleLabels()).toEqual(['Torus Knot', 'rotation', 'wireframe'])
    expect(document.querySelectorAll('.k411-timeline-lane')).toHaveLength(3)
    expect(document.querySelectorAll('.k411-timeline-keyframe--aggregate')).toHaveLength(4)

    disclosure('Colapsar objeto Torus Knot')?.click()
    expect(visibleLabels()).toEqual(['Torus Knot'])
    expect(document.querySelectorAll('.k411-timeline-lane')).toHaveLength(1)

    disclosure('Desplegar objeto Torus Knot')?.click()
    expect(visibleLabels()).toEqual(['Torus Knot', 'rotation', 'wireframe'])
    expect(view.rowExpansion.collapsedRowIds).toEqual([
      'Torus Knot:["rotation"]',
    ])

    disclosure('Desplegar grupo rotation')?.click()
    expect(visibleLabels()).toEqual([
      'Torus Knot',
      'rotation',
      'x',
      'y',
      'z',
      'wireframe',
    ])
    expect(view.rowExpansion.collapsedRowIds).toEqual([])
    expect(timeline.stringify()).toBe(documentBefore)

    view.dispose()
    timeline.dispose()
  })

  it('añade layers desde el catálogo del objeto mediante el botón +', () => {
    const timeline = createTimeline({id: 'property-picker'})
    const composition = timeline.composition('Scene')
    const object = composition.object('Cube', {
      position: types.compound({x: 0, y: 0, z: 0}, {label: 'Posición'}),
      visible: types.boolean(true, {label: 'Visible'}),
    })
    registerTimelineObjectPropertyCatalog(object, {
      objectType: 'test.mesh',
      properties: [
        {
          path: ['position'],
          category: 'Transformación',
          read: () => ({x: 1, y: 2, z: 3}),
        },
        {
          path: ['visible'],
          category: 'Objeto',
          read: () => false,
        },
      ],
    })
    const view = new Timeline411HtmlView(timeline, 'Scene')
    view.mount('#timeline-test')

    const addButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Añadir propiedad a Cube"]',
    )
    expect(addButton?.textContent).toBe('+')
    expect(
      document.querySelector('.k411-timeline-tree-row__disclosure'),
    ).toBeNull()
    addButton?.click()

    const picker = document.querySelector<HTMLSelectElement>(
      '.k411-timeline-tree-row__property-picker',
    )
    expect(
      [...(picker?.querySelectorAll('optgroup') ?? [])].map(({label}) => label),
    ).toEqual(['Transformación', 'Objeto'])
    expect(
      [...(picker?.querySelectorAll('option') ?? [])].map(({textContent}) =>
        textContent,
      ),
    ).toEqual(['Seleccionar…', 'Posición', 'Visible'])
    if (!picker) throw new Error('No se encontró el selector de propiedades')
    picker.value = '["position"]'
    picker.dispatchEvent(new Event('change', {bubbles: true}))

    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube.position,
    ).toEqual({x: 1, y: 2, z: 3})
    expect(timeline.store.history.undoLabel).toBe('Añadir propiedad Posición')
    expect(
      [...document.querySelectorAll<HTMLElement>(
        '.k411-timeline-tree-row__label',
      )].map(({textContent}) => textContent),
    ).toEqual(['Cube', 'Posición', 'x', 'y', 'z'])
    expect(
      document.querySelector('.k411-timeline-tree-row__property-picker'),
    ).toBeNull()
    expect(
      document.querySelector('.k411-timeline-tree-row__disclosure'),
    ).not.toBeNull()

    expect(timeline.store.undo()).toBe(true)
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube.position,
    ).toBeUndefined()
    expect(
      [...document.querySelectorAll<HTMLElement>(
        '.k411-timeline-tree-row__label',
      )].map(({textContent}) => textContent),
    ).toEqual(['Cube'])

    view.dispose()
    timeline.dispose()
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

  it('sincroniza zoom, pan, fit, scrollbar y mantiene viewports independientes', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="timeline-second"></div>')
    const timeline = new Timeline411(projectState)
    const first = new Timeline411HtmlView(timeline, 'Animated scene')
    const second = new Timeline411HtmlView(timeline, 'Animated scene')
    first.mount('#timeline-test')
    second.mount('#timeline-second')

    const firstScroll = document.querySelector<HTMLElement>(
      '#timeline-test .k411-timeline-scroll',
    )
    if (!firstScroll) throw new Error('No se encontró el scroll temporal')
    Object.defineProperty(firstScroll, 'clientWidth', {configurable: true, value: 600})
    first.viewport.setMetrics(3, 30, 600)
    second.viewport.setMetrics(3, 30, 600)
    const reasons: string[] = []
    first.on('viewport:change', (event) => reasons.push(event.reason))

    firstScroll.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        ctrlKey: true,
        deltaY: -350,
      }),
    )
    expect(first.viewport.snapshot.zoom).toBeGreaterThan(1)
    expect(second.viewport.snapshot.zoom).toBe(1)
    expect(reasons).toContain('zoom')

    const beforePan = first.viewport.snapshot.visibleStart
    const root = document.querySelector<HTMLElement>(
      '#timeline-test [data-timeline411-view]',
    )
    root?.dispatchEvent(
      new KeyboardEvent('keydown', {bubbles: true, code: 'Space', key: ' '}),
    )
    firstScroll.dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 300}),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 200}),
    )
    window.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, button: 0}))
    root?.dispatchEvent(
      new KeyboardEvent('keyup', {bubbles: true, code: 'Space', key: ' '}),
    )
    expect(first.viewport.snapshot.visibleStart).toBeGreaterThan(beforePan)
    expect(reasons).toContain('pan')

    firstScroll.scrollLeft = 0
    firstScroll.dispatchEvent(new Event('scroll'))
    expect(first.viewport.snapshot.visibleStart).toBe(0)
    expect(reasons).toContain('scroll')

    root?.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'f'}))
    expect(first.viewport.snapshot).toMatchObject({
      visibleRange: [0, 3],
      zoom: 1,
      mode: 'fit',
    })
    expect(reasons).toContain('fit')

    first.viewport.zoomAt(1.5, 2)
    document
      .querySelector<HTMLElement>('#timeline-test .k411-timeline-ruler')
      ?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
    expect(first.viewport.snapshot.mode).toBe('fit')

    first.dispose()
    second.dispose()
    timeline.dispose()
  })

  it('edita la duración desde la toolbar con confirmación, cancelación y undo', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')
    const duration = document.querySelector<HTMLInputElement>(
      '.k411-timeline-duration-input',
    )
    if (!duration) throw new Error('No se encontró el editor de duración')
    expect(duration.value).toBe('3.000')

    duration.focus()
    duration.value = '8.12567'
    duration.dispatchEvent(new Event('input', {bubbles: true}))
    duration.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    expect(timeline.getDuration('Animated scene')).toBe(8.12567)
    expect(duration.value).toBe('8.126')
    expect(view.viewport.snapshot.visibleRange).toEqual([0, 8.12567])
    expect(timeline.store.history.undoLabel).toBe('Cambiar duración a 8.126s')

    expect(timeline.store.undo()).toBe(true)
    expect(timeline.getDuration('Animated scene')).toBe(3)
    expect(duration.value).toBe('3.000')
    expect(view.viewport.snapshot.visibleRange).toEqual([0, 3])

    duration.focus()
    duration.value = '6'
    duration.dispatchEvent(new Event('input', {bubbles: true}))
    duration.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    )
    expect(timeline.getDuration('Animated scene')).toBe(3)
    expect(duration.value).toBe('3.000')

    duration.focus()
    duration.value = '4.5'
    duration.dispatchEvent(new Event('input', {bubbles: true}))
    duration.blur()
    expect(timeline.getDuration('Animated scene')).toBe(4.5)
    expect(duration.value).toBe('4.500')

    duration.focus()
    duration.value = '0'
    duration.dispatchEvent(new Event('input', {bubbles: true}))
    duration.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    expect(timeline.getDuration('Animated scene')).toBe(4.5)
    expect(duration.validationMessage).toMatch(/mayor que cero/)
    duration.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    )
    expect(duration.value).toBe('4.500')

    view.dispose()
    timeline.dispose()
  })

  it('edita el tiempo del keyframe seleccionado con snapping y validación', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')
    const keyframeTime = document.querySelector<HTMLInputElement>(
      '.k411-timeline-keyframe-time-input',
    )
    if (!keyframeTime) throw new Error('No se encontró el editor de tiempo del keyframe')
    expect(keyframeTime.disabled).toBe(true)
    expect(keyframeTime.value).toBe('')
    expect(keyframeTime.title).toMatch(/Selecciona un keyframe/)

    timeline.player.seek(1)
    expect(keyframeTime.disabled).toBe(true)
    expect(keyframeTime.value).toBe('')

    const lastXKeyframe = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 3.000s')
    if (!lastXKeyframe) throw new Error('No se encontró el último keyframe de x')
    lastXKeyframe.click()
    expect(keyframeTime.disabled).toBe(false)
    expect(keyframeTime.value).toBe('3.000')

    timeline.player.seek(1)
    expect(keyframeTime.disabled).toBe(false)
    expect(keyframeTime.value).toBe('3.000')

    keyframeTime.focus()
    keyframeTime.dispatchEvent(new Event('input', {bubbles: true}))
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    expect(timeline.player.position).toBe(3)

    keyframeTime.focus()
    keyframeTime.value = '2.234'
    keyframeTime.dispatchEvent(new Event('input', {bubbles: true}))
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    const lastXPosition = () =>
      timeline.document.sheetsById['Animated scene'].sequence?.tracksByObject[
        'Torus Knot'
      ].trackData.Q9IUK1iBde?.keyframes[1].position
    expect(lastXPosition()).toBe(2.233333)
    expect(timeline.player.position).toBe(2.233333)
    expect(keyframeTime.value).toBe('2.233')
    expect(timeline.store.history.undoLabel).toBe('Mover keyframe a 2.233s')

    expect(timeline.store.undo()).toBe(true)
    expect(lastXPosition()).toBe(3)
    expect(keyframeTime.value).toBe('3.000')

    keyframeTime.focus()
    keyframeTime.value = '0'
    keyframeTime.dispatchEvent(new Event('input', {bubbles: true}))
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    expect(lastXPosition()).toBe(3)
    expect(keyframeTime.validationMessage).toMatch(/otro keyframe/)
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    )

    keyframeTime.focus()
    keyframeTime.value = '4'
    keyframeTime.dispatchEvent(new Event('input', {bubbles: true}))
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    )
    expect(lastXPosition()).toBe(3)
    expect(keyframeTime.validationMessage).toMatch(/entre 0 y 3.000/)
    keyframeTime.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    )

    document
      .querySelector<HTMLElement>('[data-timeline411-view]')
      ?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}))
    expect(keyframeTime.disabled).toBe(true)
    expect(keyframeTime.value).toBe('')

    view.dispose()
    timeline.dispose()
  })

  it('crea y quita keyframes en una propiedad estática mediante rombo y lane', () => {
    const timeline = createTimeline({id: 'wireframe-view', state: projectState})
    timeline.composition('Animated scene').object('Torus Knot', {
      rotation: {x: 0, y: 0, z: 0},
      wireframe: true,
    })
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')
    timeline.player.seek(1)

    const wireframeRow = findPropertyRow('wireframe')
    const initialToggle = wireframeRow.querySelector<HTMLButtonElement>(
      '.k411-timeline-tree-row__keyframe-toggle',
    )
    expect(initialToggle?.textContent).toBe('◇')
    initialToggle?.click()

    const getWireframeTrack = () => {
      const objectTracks = timeline.document.sheetsById['Animated scene'].sequence
        ?.tracksByObject['Torus Knot']
      const trackId = objectTracks?.trackIdByPropPath['["wireframe"]']
      return trackId ? objectTracks?.trackData[trackId] : undefined
    }
    expect(getWireframeTrack()?.keyframes).toEqual([
      expect.objectContaining({position: 1, value: true}),
    ])
    expect(
      findPropertyRow('wireframe').querySelector<HTMLButtonElement>(
        '.k411-timeline-tree-row__keyframe-toggle',
      )?.textContent,
    ).toBe('◆')
    expect(
      document.querySelector<HTMLInputElement>(
        '.k411-timeline-keyframe-time-input',
      )?.value,
    ).toBe('1.000')

    findPropertyRow('wireframe')
      .querySelector<HTMLButtonElement>('.k411-timeline-tree-row__keyframe-toggle')
      ?.click()
    expect(getWireframeTrack()).toBeUndefined()
    expect(
      timeline.document.sheetsById['Animated scene'].staticOverrides.byObject[
        'Torus Knot'
      ].wireframe,
    ).toBe(true)
    expect(timeline.store.history.undoLabel).toBe('Quitar keyframe de wireframe')

    expect(timeline.store.undo()).toBe(true)
    expect(getWireframeTrack()?.keyframes).toHaveLength(1)
    expect(timeline.store.redo()).toBe(true)
    expect(getWireframeTrack()).toBeUndefined()

    view.viewport.setMetrics(3, 30, 300)
    const wireframeLane = [...document.querySelectorAll<HTMLElement>(
      '.k411-timeline-lane',
    )].find((lane) => lane.dataset.rowId?.endsWith('["wireframe"]'))
    if (!wireframeLane) throw new Error('No se encontró la lane de wireframe')
    wireframeLane.dispatchEvent(
      new MouseEvent('dblclick', {bubbles: true, cancelable: true, clientX: 200}),
    )
    expect(getWireframeTrack()?.keyframes).toEqual([
      expect.objectContaining({position: 2, value: true}),
    ])

    view.dispose()
    timeline.dispose()
  })

  it('deselecciona con clic sencillo en el fondo sin mover el playhead', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    const selections: Array<string | undefined> = []
    view.on('selection:change', ({selection}) => {
      selections.push(selection?.keyframeId)
    })
    view.mount('#timeline-test')

    const keyframe = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 0.000s')
    if (!keyframe) throw new Error('No se encontró el keyframe de x')
    keyframe.click()
    expect(timeline.player.position).toBe(0)

    const keyframeTime = document.querySelector<HTMLInputElement>(
      '.k411-timeline-keyframe-time-input',
    )
    const interpolation = document.querySelector<HTMLSelectElement>(
      '.k411-timeline-preset',
    )
    expect(keyframeTime?.disabled).toBe(false)
    expect(interpolation?.disabled).toBe(false)

    document
      .querySelector<HTMLElement>('.k411-timeline-ruler')
      ?.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}))
    expect(keyframeTime?.disabled).toBe(false)

    document
      .querySelector<HTMLElement>('.k411-timeline-lane--track')
      ?.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}))
    expect(timeline.player.position).toBe(0)
    expect(keyframeTime?.disabled).toBe(true)
    expect(keyframeTime?.value).toBe('')
    expect(interpolation?.disabled).toBe(true)
    expect(
      document.querySelector('.k411-timeline-keyframe--selected'),
    ).toBeNull()
    expect(selections.at(-1)).toBeUndefined()

    view.dispose()
    timeline.dispose()
  })

  it('organiza la toolbar y muestra el easing real sólo con un KF seleccionado', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')

    const toolbar = document.querySelector<HTMLElement>('.k411-timeline-toolbar')
    const basic = toolbar?.querySelector<HTMLElement>(
      '.k411-timeline-toolbar__basic',
    )
    const context = toolbar?.querySelector<HTMLElement>(
      '.k411-timeline-toolbar__keyframe-context',
    )
    const actions = toolbar?.querySelector<HTMLElement>(
      '.k411-timeline-toolbar__actions',
    )
    const interpolation = toolbar?.querySelector<HTMLSelectElement>(
      '.k411-timeline-preset',
    )
    if (!toolbar || !basic || !context || !actions || !interpolation) {
      throw new Error('No se encontraron los bloques de la toolbar')
    }
    expect([...toolbar.children]).toEqual([basic, context, actions])
    expect(basic.textContent).toContain('Timeline 411')
    expect(context.hidden).toBe(true)
    expect(
      [...actions.querySelectorAll<HTMLButtonElement>('button')].map(
        (button) => button.textContent,
      ),
    ).toEqual(['↶', '↷', 'JSON'])

    const firstX = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 0.000s')
    if (!firstX) throw new Error('No se encontró el primer keyframe de x')
    firstX.click()
    expect(context.hidden).toBe(false)
    expect(context.querySelector('.k411-timeline-toolbar__context-title')?.textContent)
      .toBe('KF seleccionado:')
    expect(
      context.querySelector<HTMLInputElement>('.k411-timeline-keyframe-time-input')
        ?.value,
    ).toBe('0.000')
    expect(interpolation.value).toBe('imported')
    expect(interpolation.selectedOptions[0]?.textContent).toBe('Curva importada')
    expect(interpolation.disabled).toBe(false)

    interpolation.value = 'linear'
    interpolation.dispatchEvent(new Event('change', {bubbles: true}))
    expect(interpolation.value).toBe('linear')
    const xTrack = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData.Q9IUK1iBde
    expect(xTrack?.keyframes[0].handles.slice(2)).toEqual([0, 0])
    expect(xTrack?.keyframes[1].handles.slice(0, 2)).toEqual([1, 1])

    const lastX = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 3.000s')
    if (!lastX) throw new Error('No se encontró el último keyframe de x')
    lastX.click()
    expect(context.hidden).toBe(false)
    expect(interpolation.value).toBe('none')
    expect(interpolation.selectedOptions[0]?.textContent).toBe('Sin segmento')
    expect(interpolation.disabled).toBe(true)

    document
      .querySelector<HTMLElement>('.k411-timeline-lane--track')
      ?.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}))
    expect(context.hidden).toBe(true)

    view.dispose()
    timeline.dispose()
  })

  it('arrastra el keyframe y desplaza el playhead de forma sincronizada', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')
    view.viewport.setMetrics(3, 30, 300)

    const keyframe = [...document.querySelectorAll<HTMLButtonElement>(
      '.k411-timeline-keyframe',
    )].find((button) => button.title === 'x: 3.000s')
    const playhead = document.querySelector<HTMLButtonElement>(
      '.k411-timeline-playhead',
    )
    if (!keyframe || !playhead) {
      throw new Error('No se encontraron el keyframe y el playhead')
    }
    keyframe.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 300,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 200}),
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {bubbles: true, button: 0, clientX: 200}),
    )

    const moved = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData.Q9IUK1iBde?.keyframes.find(
        (candidate) => candidate.id === '6qCOzmWF9R',
      )
    expect(moved?.position).toBe(2)
    expect(timeline.player.position).toBe(2)
    expect(
      document.querySelector<HTMLInputElement>(
        '.k411-timeline-keyframe-time-input',
      )?.value,
    ).toBe('2.000')

    view.dispose()
    timeline.dispose()
  })

  it('selecciona, mueve y elimina varios keyframes como un solo grupo', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    const selectionEvents: Array<{primary?: string; ids: string[]}> = []
    view.on('selection:change', ({selection, selections}) => {
      selectionEvents.push({
        primary: selection?.keyframeId,
        ids: selections.map(({keyframeId}) => keyframeId),
      })
    })
    view.mount('#timeline-test')
    view.viewport.setMetrics(3, 30, 300)

    const findKeyframeButton = (title: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(
        '.k411-timeline-keyframe',
      )].find((button) => button.title === title)

    findKeyframeButton('x: 3.000s')?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 300,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {bubbles: true, button: 0, clientX: 300}),
    )
    expect(
      document.querySelectorAll('.k411-timeline-keyframe--selected'),
    ).toHaveLength(1)
    findKeyframeButton('y: 3.000s')?.dispatchEvent(
      new MouseEvent('click', {bubbles: true, ctrlKey: true}),
    )
    expect(
      document.querySelectorAll('.k411-timeline-keyframe--selected'),
    ).toHaveLength(2)
    expect(
      document.querySelectorAll('.k411-timeline-keyframe--primary'),
    ).toHaveLength(1)
    expect(selectionEvents.at(-1)).toEqual({
      primary: 'V1i_Ve-dDz',
      ids: ['6qCOzmWF9R', 'V1i_Ve-dDz'],
    })
    expect(
      document.querySelector<HTMLElement>(
        '.k411-timeline-toolbar__keyframe-context',
      )?.hidden,
    ).toBe(true)

    findKeyframeButton('x: 3.000s')?.click()
    expect(view.selection.selections).toHaveLength(1)
    expect(view.selection.selection?.keyframeId).toBe('6qCOzmWF9R')
    expect(
      document.querySelector<HTMLElement>(
        '.k411-timeline-toolbar__keyframe-context',
      )?.hidden,
    ).toBe(false)
    findKeyframeButton('y: 3.000s')?.dispatchEvent(
      new MouseEvent('click', {bubbles: true, ctrlKey: true}),
    )

    findKeyframeButton('x: 3.000s')?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 300,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 100}),
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {bubbles: true, button: 0, clientX: 100}),
    )

    const tracks = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData
    expect(
      tracks?.Q9IUK1iBde.keyframes.find(({id}) => id === '6qCOzmWF9R')?.position,
    ).toBe(1)
    expect(
      tracks?.rVM9fvISsC.keyframes.find(({id}) => id === 'V1i_Ve-dDz')?.position,
    ).toBe(1)
    expect(timeline.player.position).toBe(1)
    expect(timeline.store.history.undoLabel).toBe('Mover 2 keyframes')

    expect(timeline.store.undo()).toBe(true)
    const restoredTracks = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData
    expect(
      restoredTracks?.Q9IUK1iBde.keyframes.find(({id}) => id === '6qCOzmWF9R')
        ?.position,
    ).toBe(3)
    expect(
      restoredTracks?.rVM9fvISsC.keyframes.find(({id}) => id === 'V1i_Ve-dDz')
        ?.position,
    ).toBe(3)

    findKeyframeButton('x: 3.000s')?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 300,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 0}),
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {bubbles: true, button: 0, clientX: 0}),
    )
    const constrainedTracks = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData
    expect(
      constrainedTracks?.Q9IUK1iBde.keyframes.find(
        ({id}) => id === '6qCOzmWF9R',
      )?.position,
    ).toBe(0.033333)
    expect(
      constrainedTracks?.rVM9fvISsC.keyframes.find(
        ({id}) => id === 'V1i_Ve-dDz',
      )?.position,
    ).toBe(0.033333)
    expect(timeline.store.undo()).toBe(true)

    document
      .querySelector<HTMLElement>('[data-timeline411-view]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true}),
      )
    expect(timeline.store.history.undoLabel).toBe('Eliminar 2 keyframes')
    expect(
      document.querySelectorAll('.k411-timeline-keyframe--selected'),
    ).toHaveLength(0)
    expect(selectionEvents.at(-1)).toEqual({primary: undefined, ids: []})
    expect(timeline.store.undo()).toBe(true)
    expect(
      timeline.document.sheetsById['Animated scene'].sequence?.tracksByObject[
        'Torus Knot'
      ].trackData.Q9IUK1iBde.keyframes,
    ).toHaveLength(2)
    expect(
      timeline.document.sheetsById['Animated scene'].sequence?.tracksByObject[
        'Torus Knot'
      ].trackData.rVM9fvISsC.keyframes,
    ).toHaveLength(2)

    findKeyframeButton('x: 0.000s')?.click()
    findKeyframeButton('x: 3.000s')?.dispatchEvent(
      new MouseEvent('click', {bubbles: true, ctrlKey: true}),
    )
    document
      .querySelector<HTMLElement>('[data-timeline411-view]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}),
      )
    const objectTracks = timeline.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot']
    expect(objectTracks?.trackIdByPropPath['["rotation","x"]']).toBeUndefined()
    expect(objectTracks?.trackData.Q9IUK1iBde).toBeUndefined()
    expect(
      timeline.document.sheetsById['Animated scene'].staticOverrides.byObject[
        'Torus Knot'
      ].rotation,
    ).toEqual(expect.objectContaining({x: expect.any(Number)}))
    expect(timeline.store.undo()).toBe(true)

    view.dispose()
    timeline.dispose()
  })

  it('permite manejar el playhead sólo desde el ruler y su handle superior', () => {
    const timeline = new Timeline411(projectState)
    const view = new Timeline411HtmlView(timeline, 'Animated scene')
    view.mount('#timeline-test')
    view.viewport.setMetrics(3, 30, 300)

    const line = document.querySelector<HTMLElement>('.k411-timeline-playhead')
    const handle = document.querySelector<HTMLButtonElement>(
      '.k411-timeline-playhead-handle',
    )
    const ruler = document.querySelector<HTMLElement>('.k411-timeline-ruler')
    if (!line || !handle || !ruler) {
      throw new Error('No se encontraron las partes del playhead')
    }
    expect(line.tagName).toBe('SPAN')
    expect(line.getAttribute('aria-hidden')).toBe('true')

    line.dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 150}),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 200}),
    )
    window.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, button: 0}))
    expect(timeline.player.position).toBe(0)

    handle.dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 150}),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {bubbles: true, button: 0, clientX: 200}),
    )
    window.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, button: 0}))
    expect(timeline.player.position).toBe(2)

    ruler.dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 100}),
    )
    window.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, button: 0}))
    expect(timeline.player.position).toBe(1)

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
