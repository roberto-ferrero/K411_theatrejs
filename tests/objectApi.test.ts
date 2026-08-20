import {describe, expect, it} from 'vitest'
import {createTimeline, types} from '../src/timeline411'

function deterministicIds() {
  let index = 0
  return (prefix: string): string => `${prefix}_${++index}`
}

describe('API pública de objetos y tracks', () => {
  it('crea compositions y objetos idempotentes con referencias tipadas', () => {
    const timeline = createTimeline({id: 'objects', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    expect(timeline.sheet('Scene')).toBe(composition)

    const object = composition.object('Cube', {
      position: {x: types.number(0), y: 1},
      visible: true,
      label: 'Cube',
    })
    const sameObject = composition.object('Cube', {
      position: {x: types.number(10), y: 20},
      visible: false,
      label: 'Other default',
    })

    expect(sameObject).toBe(object)
    expect(object.value).toEqual({
      position: {x: 0, y: 1},
      visible: true,
      label: 'Cube',
    })
    expect(object.props.position.x.get()).toBe(0)
    expect(() =>
      composition.object('Cube', {position: {x: 0}, visible: true}),
    ).toThrow(/schema incompatible/)
    timeline.dispose()
  })

  it('edita static overrides y tracks en transacciones reversibles', () => {
    const timeline = createTimeline({id: 'editing', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    const object = composition.object('Cube', {x: 0, visible: true})
    const observed: number[] = []
    const unsubscribe = object.props.x.onChange((value) => observed.push(value))

    timeline.editor.transaction((transaction) => {
      transaction.set(object.props.x, 2)
      transaction.set(object.props.visible, false)
    }, {label: 'Static values'})
    expect(object.value).toEqual({x: 2, visible: false})
    timeline.editor.transaction((transaction) => transaction.unset(object.props.visible))
    expect(object.value.visible).toBe(true)

    const track = timeline.editor.transaction(
      (transaction) => transaction.sequence(object.props.x),
      {label: 'Sequence x'},
    )
    expect(composition.getTrackFor(object.props.x)).toBe(track)
    expect(timeline.editor.getTrackFor(object.props.x)).toBe(track)
    expect(track.getKeyframes()).toHaveLength(1)

    composition.sequence.position = 1
    timeline.editor.transaction((transaction) => transaction.set(object.props.x, 4))
    expect(track.getKeyframes().map((keyframe) => keyframe.snapshot.position)).toEqual([
      0,
      1,
    ])
    composition.sequence.position = 0.5
    expect(object.value.x).toBeCloseTo(3)

    timeline.editor.transaction((transaction) => transaction.unsequence(object.props.x))
    expect(composition.getTrackFor(object.props.x)).toBeUndefined()
    expect(object.value.x).toBeCloseTo(3)
    expect(timeline.editor.history.undo()).toBe(true)
    expect(composition.getTrackFor(object.props.x)).toBe(track)
    expect(object.value.x).toBeCloseTo(3)
    expect(timeline.editor.history.redo()).toBe(true)
    expect(composition.getTrackFor(object.props.x)).toBeUndefined()
    expect(observed).toContain(2)
    expect(observed).toContain(3)

    unsubscribe()
    timeline.dispose()
  })

  it('compone operaciones dependientes dentro de una misma transacción', () => {
    const timeline = createTimeline({id: 'atomic', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    const object = composition.object('Cube', {x: 0})

    const track = timeline.editor.transaction((transaction) => {
      transaction.set(object.props.x, 3)
      const createdTrack = transaction.sequence(object.props.x)
      transaction.set(object.props.x, 4)
      return createdTrack
    })

    expect(track.getKeyframes()).toHaveLength(1)
    expect(track.getKeyframes()[0].snapshot.value).toBe(4)
    expect(track.getKeyframes()[0]).toBe(track.getKeyframe(track.getKeyframes()[0].id))
    expect(object.value.x).toBe(4)
    timeline.dispose()
  })

  it('expone CRUD de keyframes mediante handles estables', () => {
    const timeline = createTimeline({id: 'keyframes', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    const object = composition.object('Cube', {x: 0})
    const track = timeline.editor.transaction((transaction) =>
      transaction.sequence(object.props.x),
    )
    const first = track.getKeyframes()[0]

    const second = timeline.editor.transaction((transaction) => {
      const created = transaction.addKeyframe(track, {position: 2, value: 10})
      transaction.setInterpolation(first, 'linear')
      return created
    })
    expect(track.getKeyframe(second.id)).toBe(second)
    expect(track.evaluate(1)).toBeCloseTo(5)

    timeline.editor.transaction((transaction) => {
      transaction.updateKeyframe(second, {position: 3, value: 12})
    })
    expect(second.snapshot).toMatchObject({position: 3, value: 12})
    timeline.editor.transaction((transaction) => transaction.removeKeyframe(second))
    expect(track.getKeyframe(second.id)).toBeUndefined()
    timeline.dispose()
  })

  it('añade keyframes por propiedad y elimina el track al quitar el último', () => {
    const timeline = createTimeline({
      id: 'property-keyframes',
      idFactory: deterministicIds(),
    })
    const composition = timeline.composition('Scene')
    const object = composition.object('Material', {wireframe: true})

    timeline.store.transaction('Crear track vacío', (transaction) => {
      transaction.sequenceProperty(object.props.wireframe.address)
    })
    expect(composition.getTrackFor(object.props.wireframe)?.getKeyframes()).toHaveLength(0)

    const created = timeline.editor.transaction((transaction) =>
      transaction.addKeyframeAt(object.props.wireframe, {position: 1.014}),
    )
    const track = composition.getTrackFor(object.props.wireframe)
    expect(created).toMatchObject({
      sheetId: 'Scene',
      objectKey: 'Material',
      keyframeId: expect.any(String),
    })
    expect(track?.snapshot.keyframes).toEqual([
      expect.objectContaining({position: 1, value: true}),
    ])

    const removed = timeline.editor.transaction((transaction) =>
      transaction.removeKeyframeAt(object.props.wireframe, 1),
    )
    expect(removed).toEqual(created)
    expect(composition.getTrackFor(object.props.wireframe)).toBeUndefined()
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Material
        .wireframe,
    ).toBe(true)

    expect(timeline.editor.history.undo()).toBe(true)
    expect(composition.getTrackFor(object.props.wireframe)?.getKeyframes()).toHaveLength(1)
    expect(timeline.editor.history.redo()).toBe(true)
    expect(composition.getTrackFor(object.props.wireframe)).toBeUndefined()
    timeline.dispose()
  })

  it('usa interpoladores personalizados durante la evaluación', () => {
    const timeline = createTimeline({id: 'interpolators', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    const object = composition.object('Label', {
      text: types.string('left', {
        interpolate: (left, right, progression) =>
          progression < 0.25 ? left : right,
      }),
    })
    timeline.editor.transaction((transaction) => transaction.sequence(object.props.text))
    composition.sequence.position = 1
    timeline.editor.transaction((transaction) => transaction.set(object.props.text, 'right'))

    composition.sequence.position = 0.5
    expect(object.value.text).toBe('right')
    timeline.dispose()
  })

  it('separa detach de forgetObject y conserva undo', () => {
    const timeline = createTimeline({id: 'lifecycle', idFactory: deterministicIds()})
    const composition = timeline.composition('Scene')
    const object = composition.object('Cube', {x: 0})
    timeline.editor.transaction((transaction) => transaction.set(object.props.x, 5))

    object.detach()
    expect(composition.getObject('Cube')).toBeUndefined()
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube,
    ).toEqual({x: 5})

    const attachedAgain = composition.object('Cube', {x: 0})
    timeline.editor.forgetObject(attachedAgain)
    expect(composition.getObject('Cube')).toBeUndefined()
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube,
    ).toBeUndefined()
    expect(timeline.editor.history.undo()).toBe(true)
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube,
    ).toEqual({x: 5})
    timeline.dispose()
  })

  it('mantiene un player independiente por composition', () => {
    const timeline = createTimeline({id: 'sheets', idFactory: deterministicIds()})
    const first = timeline.composition('First')
    const second = timeline.composition('Second')
    timeline.editor.transaction((transaction) => {
      transaction.setDuration('First', 4)
      transaction.setFps('Second', 60)
    })

    first.sequence.position = 2
    second.sequence.position = 7

    expect(first.sequence.position).toBe(2)
    expect(second.sequence.position).toBe(7)
    expect(first.sequence.length).toBe(4)
    expect(second.sequence.fps).toBe(60)
    expect(timeline.getCompositions()).toEqual([first, second])
    timeline.dispose()
  })
})
