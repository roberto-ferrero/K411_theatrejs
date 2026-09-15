import {describe, expect, it} from 'vitest'
import {
  getTimelineEventCue,
  timelineEventsObjectKey,
} from '../src/timeline411/eventTracks'
import type {KeyframeAddress} from '../src/timeline411/model'
import {buildTimelineRows, projectTimelineRowValue} from '../src/timeline411/projection'
import {createTimeline} from '../src/timeline411/timeline'

function createEventTimeline() {
  let id = 0
  const timeline = createTimeline({
    id: 'events-test',
    idFactory: (prefix) => `${prefix}_${++id}`,
  })
  timeline.composition('Scene')
  timeline.editor.transaction((transaction) => {
    transaction.setDuration('Scene', 3)
  })
  return timeline
}

describe('familias y cues de eventos', () => {
  it('crea varias familias y varios eventos por familia con metadata editable', () => {
    const timeline = createEventTimeline()
    let explosion!: {sheetId: string; familyId: string}
    let firstCue!: KeyframeAddress

    timeline.editor.transaction((transaction) => {
      explosion = transaction.addEventFamily('Scene', 'Explosión')
      transaction.addEventFamily('Scene', 'Cambiar cámara')
      firstCue = transaction.addEventCue(explosion, {
        position: 0.5,
        label: 'Carga A',
        payload: {intensity: 2, source: 'torus'},
      })
      transaction.addEventCue(explosion, {position: 1.5})
      transaction.addEventCue(explosion, {position: 2.5, label: 'Carga C'})
    }, {label: 'Crear eventos'})

    const families = timeline.getEventFamilies('Scene')
    expect(families.map(({label}) => label)).toEqual([
      'Explosión',
      'Cambiar cámara',
    ])
    expect(families[0].cues.map(({position}) => position)).toEqual([0.5, 1.5, 2.5])
    expect(families[0].cues[0]).toMatchObject({
      label: 'Carga A',
      payload: {intensity: 2, source: 'torus'},
    })

    timeline.editor.transaction((transaction) => {
      transaction.updateEventCue(firstCue, {
        label: 'Carga principal',
        payload: {intensity: 4},
      })
      transaction.renameEventFamily(explosion, 'Detonación')
    })
    expect(timeline.getEventFamilies('Scene')[0].label).toBe('Detonación')
    expect(timeline.getEventFamilies('Scene')[0].cues[0]).toMatchObject({
      label: 'Carga principal',
      payload: {intensity: 4},
    })
    expect(getTimelineEventCue(timeline.document, firstCue)?.familyLabel).toBe(
      'Detonación',
    )
    timeline.dispose()
  })

  it('mantiene la familia al borrar su último cue y elimina todo al borrar la familia', () => {
    const timeline = createEventTimeline()
    let family!: {sheetId: string; familyId: string}
    let cue!: KeyframeAddress
    timeline.editor.transaction((transaction) => {
      family = transaction.addEventFamily('Scene', 'Explosión')
      cue = transaction.addEventCue(family, {position: 1})
    })

    timeline.editor.transaction((transaction) => transaction.removeEventCue(cue))
    expect(timeline.getEventFamilies('Scene')[0].cues).toEqual([])
    expect(
      timeline.document.sheetsById.Scene.sequence?.tracksByObject[
        timelineEventsObjectKey
      ],
    ).toBeDefined()

    timeline.editor.transaction((transaction) => transaction.removeEventFamily(family))
    expect(timeline.getEventFamilies('Scene')).toEqual([])
    expect(
      timeline.document.sheetsById.Scene.sequence?.tracksByObject[
        timelineEventsObjectKey
      ],
    ).toBeUndefined()
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject[
        timelineEventsObjectKey
      ],
    ).toBeUndefined()
    expect(timeline.store.undo()).toBe(true)
    expect(timeline.getEventFamilies('Scene')[0].label).toBe('Explosión')
    timeline.dispose()
  })

  it('proyecta Eventos antes de objetos y no expone el valor codificado del cue', () => {
    const timeline = createEventTimeline()
    timeline.editor.transaction((transaction) => {
      const family = transaction.addEventFamily('Scene', 'Explosión')
      transaction.addEventCue(family, {position: 1})
    })
    const rows = buildTimelineRows(timeline.document, 'Scene')
    expect(rows.slice(0, 2).map(({kind, label}) => ({kind, label}))).toEqual([
      {kind: 'eventGroup', label: 'Eventos'},
      {kind: 'eventTrack', label: 'Explosión'},
    ])
    expect(projectTimelineRowValue(
      timeline.document,
      'Scene',
      rows[1],
      1,
      timeline.evaluate('Scene', 1),
    ).mode).toBe('keyframe')
    timeline.dispose()
  })

  it('rechaza nombres duplicados, colisiones temporales y payloads no admitidos', () => {
    const timeline = createEventTimeline()
    let family!: {sheetId: string; familyId: string}
    timeline.editor.transaction((transaction) => {
      family = transaction.addEventFamily('Scene', 'Explosión')
      transaction.addEventCue(family, {position: 1})
    })
    expect(() => timeline.editor.transaction((transaction) => {
      transaction.addEventFamily('Scene', 'explosión')
    })).toThrow(/Ya existe/)
    expect(() => timeline.editor.transaction((transaction) => {
      transaction.addEventCue(family, {position: 1})
    })).toThrow(/Ya existe un evento/)
    expect(() => timeline.editor.transaction((transaction) => {
      transaction.addEventCue(family, {
        position: 2,
        payload: null as never,
      })
    })).toThrow(/payload/)
    timeline.dispose()
  })
})
