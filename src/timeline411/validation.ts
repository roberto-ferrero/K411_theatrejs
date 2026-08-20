import type {
  SerializableValue,
  TheatreBasicKeyframedTrack,
  TheatreProjectState,
} from './model'
import {decodePropertyPath} from './paths'

export class InvalidTimelineDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTimelineDocumentError'
  }
}

export function parseTheatreProjectState(input: unknown): TheatreProjectState {
  validateTheatreProjectState(input)
  return JSON.parse(JSON.stringify(input)) as TheatreProjectState
}

export function validateTheatreProjectState(
  input: unknown,
): asserts input is TheatreProjectState {
  assertRecord(input, 'El estado raíz debe ser un objeto')
  if (input.definitionVersion !== '0.4.0') {
    fail('definitionVersion debe ser "0.4.0" para Theatre.js 0.7.2')
  }
  if (!Array.isArray(input.revisionHistory)) {
    fail('revisionHistory debe ser un array')
  }
  for (const revision of input.revisionHistory) {
    if (typeof revision !== 'string' || revision.length === 0) {
      fail('Cada revision ID debe ser un string no vacío')
    }
  }

  assertRecord(input.sheetsById, 'sheetsById debe ser un objeto')
  const globalKeyframeIds = new Set<string>()

  for (const [sheetId, sheet] of Object.entries(input.sheetsById)) {
    assertRecord(sheet, `La sheet "${sheetId}" debe ser un objeto`)
    assertRecord(
      sheet.staticOverrides,
      `staticOverrides de "${sheetId}" debe ser un objeto`,
    )
    assertRecord(
      sheet.staticOverrides.byObject,
      `staticOverrides.byObject de "${sheetId}" debe ser un objeto`,
    )
    for (const [objectKey, value] of Object.entries(
      sheet.staticOverrides.byObject,
    )) {
      assertRecord(value, `El override de "${objectKey}" debe ser un objeto`)
      assertSerializable(value, `staticOverrides.${objectKey}`)
    }

    const sequence = sheet.sequence
    if (typeof sequence === 'undefined') continue
    assertRecord(sequence, `La sequence de "${sheetId}" debe ser un objeto`)
    if (sequence.type !== 'PositionalSequence') {
      fail(`La sequence de "${sheetId}" debe ser PositionalSequence`)
    }
    assertPositiveFinite(sequence.length, `sequence.length de "${sheetId}"`)
    assertPositiveFinite(
      sequence.subUnitsPerUnit,
      `sequence.subUnitsPerUnit de "${sheetId}"`,
    )
    assertRecord(
      sequence.tracksByObject,
      `tracksByObject de "${sheetId}" debe ser un objeto`,
    )

    for (const [objectKey, objectTracks] of Object.entries(
      sequence.tracksByObject,
    )) {
      assertRecord(objectTracks, `Tracks de "${objectKey}" deben ser un objeto`)
      assertRecord(
        objectTracks.trackData,
        `trackData de "${objectKey}" debe ser un objeto`,
      )
      assertRecord(
        objectTracks.trackIdByPropPath,
        `trackIdByPropPath de "${objectKey}" debe ser un objeto`,
      )

      for (const [trackId, track] of Object.entries(objectTracks.trackData)) {
        validateTrack(track, `${sheetId}/${objectKey}/${trackId}`, globalKeyframeIds)
      }

      for (const [encodedPath, trackId] of Object.entries(
        objectTracks.trackIdByPropPath,
      )) {
        try {
          decodePropertyPath(encodedPath)
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Property path inválido')
        }
        if (typeof trackId !== 'string' || !objectTracks.trackData[trackId]) {
          fail(`El path ${encodedPath} referencia un track inexistente`)
        }
      }
    }
  }
}

function validateTrack(
  input: unknown,
  address: string,
  globalKeyframeIds: Set<string>,
): asserts input is TheatreBasicKeyframedTrack {
  assertRecord(input, `El track ${address} debe ser un objeto`)
  if (input.type !== 'BasicKeyframedTrack') {
    fail(`El track ${address} debe ser BasicKeyframedTrack`)
  }
  if (!Array.isArray(input.keyframes)) {
    fail(`Los keyframes de ${address} deben ser un array`)
  }

  let previousPosition = -Infinity
  for (const keyframe of input.keyframes) {
    assertRecord(keyframe, `Un keyframe de ${address} debe ser un objeto`)
    if (typeof keyframe.id !== 'string' || keyframe.id.length === 0) {
      fail(`Un keyframe de ${address} tiene un ID inválido`)
    }
    if (globalKeyframeIds.has(keyframe.id)) {
      fail(`Keyframe ID duplicado: ${keyframe.id}`)
    }
    globalKeyframeIds.add(keyframe.id)
    assertNonNegativeFinite(keyframe.position, `position de ${keyframe.id}`)
    if (keyframe.position < previousPosition) {
      fail(`Los keyframes de ${address} no están ordenados por position`)
    }
    previousPosition = keyframe.position
    if (typeof keyframe.connectedRight !== 'boolean') {
      fail(`connectedRight de ${keyframe.id} debe ser boolean`)
    }
    if (
      !Array.isArray(keyframe.handles) ||
      keyframe.handles.length !== 4 ||
      keyframe.handles.some(
        (handle: unknown) => typeof handle !== 'number' || !Number.isFinite(handle),
      )
    ) {
      fail(`handles de ${keyframe.id} debe contener cuatro números finitos`)
    }
    if (
      typeof keyframe.type !== 'undefined' &&
      keyframe.type !== 'bezier' &&
      keyframe.type !== 'hold'
    ) {
      fail(`type de ${keyframe.id} debe ser bezier o hold`)
    }
    assertSerializable(keyframe.value, `value de ${keyframe.id}`)
  }
}

function assertSerializable(value: unknown, address: string): void {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${address} contiene un número no finito`)
    return
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertSerializable(child, `${address}.${key}`)
    }
    return
  }
  fail(`${address} no es JSON serializable`)
}

function assertRecord(
  value: unknown,
  message: string,
): asserts value is Record<string, SerializableValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(message)
  }
}

function assertPositiveFinite(
  value: unknown,
  address: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${address} debe ser un número finito mayor que cero`)
  }
}

function assertNonNegativeFinite(
  value: unknown,
  address: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${address} debe ser un número finito mayor o igual que cero`)
  }
}

function fail(message: string): never {
  throw new InvalidTimelineDocumentError(message)
}
