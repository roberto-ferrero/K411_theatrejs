# API y eventos de un timeline inspirado en Theatre.js

Este documento propone el contrato público para crear, consultar, editar y
reproducir un timeline. La API toma como referencia la ergonomía de Theatre.js
0.7.2, pero está diseñada para que el modelo, la lógica, la interacción y la
representación permanezcan desacoplados.

> Estado: propuesta de diseño. Los nombres y contratos definidos aquí sirven
> como objetivo para la implementación; no implican que toda la API exista aún.

El vocabulario empleado se define en el
[glosario del timeline](./timeline_doc.md).

## Índice

1. [Objetivos](#1-objetivos)
2. [Correspondencia con Theatre.js](#2-correspondencia-con-theatrejs)
3. [División de la API](#3-división-de-la-api)
4. [Creación del timeline](#4-creación-del-timeline)
5. [Timeline](#5-timeline)
6. [Composition](#6-composition)
7. [TimelineObject y props](#7-timelineobject-y-props)
8. [Sequence y playback](#8-sequence-y-playback)
9. [Tracks y keyframes](#9-tracks-y-keyframes)
10. [Edición y transacciones](#10-edición-y-transacciones)
11. [Gestos temporales](#11-gestos-temporales)
12. [Selección e historial](#12-selección-e-historial)
13. [Serialización](#13-serialización)
14. [Modelo general de eventos](#14-modelo-general-de-eventos)
15. [Catálogo de eventos](#15-catálogo-de-eventos)
16. [Orden y frecuencia de los eventos](#16-orden-y-frecuencia-de-los-eventos)
17. [Ejemplo con Three.js](#17-ejemplo-con-threejs)
18. [Integración con un renderer](#18-integración-con-un-renderer)
19. [Errores y validación](#19-errores-y-validación)
20. [Versionado y compatibilidad](#20-versionado-y-compatibilidad)
21. [Alcance recomendado](#21-alcance-recomendado)
22. [Montaje, responsive y múltiples vistas](#22-montaje-responsive-y-múltiples-vistas)

## 1. Objetivos

La API debe permitir:

- Crear o cargar un documento de timeline.
- Declarar objetos y props animables.
- Vincular los valores evaluados con Three.js, DOM u otros sistemas.
- Consultar y modificar tracks y keyframes.
- Controlar play, pause, seek, dirección, rango, rate y loop.
- Agrupar cambios en transacciones compatibles con undo/redo.
- Previsualizar gestos continuos sin llenar el historial.
- Observar cambios mediante eventos tipados.
- Utilizar el mismo núcleo con una GUI HTML o WebGL.
- Sustituir el reloj para tests, audio o exportación offline.
- Importar y exportar datos sin acoplar el modelo al formato de Theatre.js.

La API no debe obligar a utilizar:

- React ni otro framework de UI.
- DOM, SVG, Canvas o WebGL.
- Three.js como modelo interno.
- `requestAnimationFrame` como única fuente de tiempo.
- El esquema JSON interno de Theatre.js como formato canónico.

## 2. Correspondencia con Theatre.js

| Theatre.js 0.7.2 | API propuesta | Función |
|---|---|---|
| `getProject(id, config)` | `createTimeline(config)` | Crear o cargar el contenedor raíz. |
| `project.ready` | `timeline.ready` | Esperar a que el documento esté preparado. |
| `project.sheet(id)` | `timeline.composition(id)` | Obtener o crear una composición. |
| `sheet.object(id, schema)` | `composition.object(id, schema)` | Declarar un objeto animable. |
| `object.props` | `object.props` | Referencias tipadas a las props. |
| `object.value` | `object.value` | Leer el valor evaluado actual. |
| `object.onValuesChange()` | `object.onValuesChange()` | Observar los valores del objeto. |
| `sheet.sequence` | `composition.sequence` | Controlar reproducción y posición. |
| `sequence.play()` | `sequence.play()` | Iniciar reproducción. |
| `sequence.pause()` | `sequence.pause()` | Pausar reproducción. |
| `sequence.position` | `sequence.position` / `seek()` | Leer o cambiar el playhead. |
| `sequence.pointer` | `sequence.subscribe()` / `on()` | Observar estado sin depender de pointers. |
| `studio.transaction()` | `timeline.editor.transaction()` | Aplicar un cambio atómico y reversible. |
| `studio.scrub()` | `timeline.editor.beginGesture()` | Previsualizar un gesto y consolidar su undo. |
| `studio.selection` | `view.editorSession.selection` | Consultar la selección de una vista. |
| `studio.onSelectionChange()` | Evento de vista `selection:change` | Observar la selección. |
| `createContentOfSaveFile()` | `timeline.serialize()` | Obtener un documento guardable. |
| `__experimental_getKeyframes()` | `track.keyframes` | Acceso público estable a los keyframes. |

Theatre.js utiliza pointers y Dataverse para observar valores derivados. La API
propuesta expone suscripciones y eventos convencionales para que el núcleo no
dependa de una librería reactiva concreta.

## 3. División de la API

La superficie pública se divide en runtime, edición y representación:

```text
Timeline
├─ ready
├─ composition()
├─ evaluate()
├─ serialize()
├─ on()
│
├─ Composition
│  ├─ object()
│  ├─ sequence
│  └─ tracks
│
└─ Editor API
   ├─ transaction()
   ├─ beginGesture()
   ├─ selection
   └─ history

Renderer (paquete separado)
├─ HTML Renderer
└─ WebGL Renderer
```

Una posible distribución futura de paquetes sería:

```text
@timeline/core       Modelo, evaluación, playback, bindings y eventos de runtime
@timeline/editor     Comandos, transacciones, selección, historial e interacción
@timeline/html       Renderer HTML/SVG
@timeline/webgl      Renderer WebGL
@timeline/theatre    Importador/exportador de Theatre.js
```

## 4. Creación del timeline

### `createTimeline(config)`

Crea el contenedor principal.

```ts
interface CreateTimelineConfig {
  id: string
  document?: TimelineDocument
  clock?: AnimationClock
  idFactory?: () => string
  logger?: TimelineLogger
}

function createTimeline(config: CreateTimelineConfig): Timeline
```

Ejemplo:

```ts
const timeline = createTimeline({
  id: 'three-scene',
  document: savedDocument,
  clock: browserAnimationClock,
})

await timeline.ready
```

Reglas:

- `id` identifica la instancia lógica del timeline.
- `document` es opcional; si se omite se crea un documento vacío válido.
- `clock` puede ser RAF, audio o un reloj determinista.
- `idFactory` permite generar IDs reproducibles durante tests.
- La creación no debe montar ninguna GUI.

## 5. Timeline

```ts
interface Timeline {
  readonly id: string
  readonly ready: Promise<void>
  readonly editor: TimelineEditor

  get document(): TimelineDocument
  get revision(): number

  composition(id: string): Composition
  getComposition(id: string): Composition | undefined
  getCompositions(): readonly Composition[]

  evaluate(time: number): TimelineSnapshot
  serialize(options?: SerializeOptions): TimelineDocument
  replaceDocument(document: TimelineDocument): void

  on<K extends keyof TimelineEventMap>(
    type: K,
    listener: (event: TimelineEventMap[K]) => void,
    options?: TimelineEventListenerOptions,
  ): Unsubscribe

  once<K extends keyof TimelineEventMap>(
    type: K,
    listener: (event: TimelineEventMap[K]) => void,
  ): Unsubscribe

  dispose(): void
}
```

### `document`

Snapshot inmutable del documento canónico. El consumidor no debe modificarlo
directamente.

### `revision`

Número entero que aumenta una vez por cada cambio confirmado del documento. Una
previsualización de gesto no incrementa la revisión pública.

### `evaluate(time)`

Evalúa el documento sin cambiar el playhead:

```ts
const snapshot = timeline.evaluate(1.5)
const rotationX = snapshot.values.get('torus.rotation.x')
```

Esto permite generar thumbnails, exportar frames o inspeccionar valores sin
interrumpir el playback.

### `replaceDocument(document)`

Reemplaza el documento completo después de validarlo. Debe pausar la reproducción,
invalidar handles antiguos y emitir `document:replace`.

### `dispose()`

Libera listeners, cancela el reloj y desactiva todos los handles. Tras `dispose`,
las operaciones deben fallar con `TimelineDisposedError`.

## 6. Composition

```ts
interface Composition {
  readonly id: string
  readonly timeline: Timeline
  readonly sequence: Sequence

  object<Props extends PropSchema>(
    id: string,
    schema: Props,
  ): TimelineObject<Props>

  getObject(id: string): TimelineObject | undefined
  getObjects(): readonly TimelineObject[]
  getTrack(id: string): TrackHandle | undefined
  getTracks(): readonly TrackHandle[]
}
```

`composition(id)` y `composition.object(id, schema)` deben ser idempotentes: dos
llamadas con el mismo ID devuelven el mismo handle mientras el esquema sea
compatible.

Ejemplo:

```ts
const scene = timeline.composition('Animated scene')

const torus = scene.object('Torus Knot', {
  rotation: compound({
    x: numberProp(0, {range: [-2, 2]}),
    y: numberProp(0, {range: [-2, 2]}),
    z: numberProp(0, {range: [-2, 2]}),
  }),
  wireframe: booleanProp(false),
})
```

## 7. TimelineObject y props

```ts
interface TimelineObject<Props extends PropSchema = PropSchema> {
  readonly id: string
  readonly composition: Composition
  readonly props: PropertyRefs<Props>
  readonly value: ValuesOf<Props>

  set initialValue(value: Partial<ValuesOf<Props>>)

  onValuesChange(
    listener: (values: ValuesOf<Props>, context: ValueChangeContext) => void,
    options?: ValueSubscriptionOptions,
  ): Unsubscribe

  bind(adapter: ObjectBindingAdapter<ValuesOf<Props>>): Unsubscribe
}
```

### `props`

Árbol de referencias tipadas. Las referencias identifican props; no contienen el
valor mutable directamente.

```ts
interface PropertyRef<T> {
  readonly objectId: string
  readonly path: readonly string[]
  readonly type: PropType<T>

  get(): T
  onChange(listener: (value: T) => void): Unsubscribe
}
```

Ejemplo:

```ts
torus.props.rotation.x.get()

torus.props.rotation.x.onChange((x) => {
  mesh.rotation.x = x * Math.PI
})
```

### `value`

Snapshot completo de los valores evaluados del objeto en la posición actual.

### `initialValue`

Override inicial específico de la instancia, aplicado antes de static overrides y
tracks secuenciados.

### `onValuesChange(listener)`

Equivalente conceptual a `object.onValuesChange()` de Theatre.js.

Reglas propuestas:

- Invoca una vez al suscribirse, salvo `emitCurrent: false`.
- Sólo vuelve a invocar si al menos una prop cambia semánticamente.
- Durante playback puede ejecutarse una vez por tick del reloj.
- Devuelve una función de desuscripción idempotente.
- Un error del listener no debe detener el player.

```ts
interface ValueSubscriptionOptions {
  emitCurrent?: boolean
  signal?: AbortSignal
  scheduler?: 'sync' | 'animationFrame' | 'microtask'
}

interface ValueChangeContext {
  time: number
  revision: number
  source: EventSource
  changedPaths: readonly PropertyPath[]
}
```

### `bind(adapter)`

Conecta el objeto lógico con un consumidor externo:

```ts
const unbind = torus.bind({
  apply(values) {
    mesh.rotation.set(
      values.rotation.x * Math.PI,
      values.rotation.y * Math.PI,
      values.rotation.z * Math.PI,
    )
    material.wireframe = values.wireframe
  },
})
```

El binding no forma parte del documento serializable.

## 8. Sequence y playback

```ts
type PlaybackDirection =
  | 'normal'
  | 'reverse'
  | 'alternate'
  | 'alternateReverse'

interface PlayOptions {
  range?: readonly [start: number, end: number]
  rate?: number
  direction?: PlaybackDirection
  iterationCount?: number
  clock?: AnimationClock
}

interface PlaybackResult {
  completed: boolean
  reason: 'ended' | 'paused' | 'stopped' | 'replaced' | 'disposed'
}

interface Sequence {
  readonly composition: Composition
  readonly duration: number
  readonly fps: number
  readonly playing: boolean
  readonly playbackState: PlaybackState

  get position(): number
  set position(value: number)

  play(options?: PlayOptions): Promise<PlaybackResult>
  pause(): void
  stop(options?: {resetTo?: 'start' | 'end' | number}): void
  seek(position: number, options?: SeekOptions): void

  subscribe(
    listener: (state: PlaybackState) => void,
    options?: ValueSubscriptionOptions,
  ): Unsubscribe
}
```

### `position`

Tiempo del playhead en segundos. Asignar `position` equivale a `seek(value)`.
La posición se restringe al rango `[0, duration]`.

### `play(options)`

Inicia o reinicia playback y devuelve una promesa que siempre resuelve con el
motivo de finalización. Pausar no debe dejar una promesa pendiente.

```ts
const result = await scene.sequence.play({
  range: [0, 3],
  rate: 1,
  direction: 'alternate',
  iterationCount: Infinity,
})
```

### `pause()`

Detiene el avance sin cambiar la posición.

### `stop()`

Detiene el avance y permite elegir dónde queda el playhead. El valor por defecto
propuesto es el inicio del rango activo.

### `seek(position)`

Mueve el playhead de forma explícita. A diferencia de Theatre.js, se recomienda
ofrecer un método además del setter porque expresa mejor la intención y puede
aceptar opciones:

```ts
interface SeekOptions {
  snap?: 'none' | 'frame'
  pause?: boolean
  source?: EventSource
}
```

### `PlaybackState`

```ts
interface PlaybackState {
  position: number
  playing: boolean
  rate: number
  direction: PlaybackDirection
  range: readonly [number, number]
  iteration: number
}
```

## 9. Tracks y keyframes

Los tracks y keyframes se exponen como snapshots inmutables y handles estables.
Las mutaciones sólo se realizan a través de una transacción o gesto.

```ts
interface TrackSnapshot<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly objectId: string
  readonly propertyPath: PropertyPath
  readonly target: string
  readonly valueType: string
  readonly keyframes: readonly KeyframeSnapshot<T>[]
  readonly muted: boolean
}

interface KeyframeSnapshot<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly time: number
  readonly value: T
  readonly interpolation: SegmentInterpolation
}

interface TrackHandle<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly composition: Composition
  readonly property: PropertyRef<T>
  readonly snapshot: TrackSnapshot<T>

  getKeyframe(id: string): KeyframeHandle<T> | undefined
  getKeyframes(): readonly KeyframeHandle<T>[]
  evaluate(time: number): T
}

interface KeyframeHandle<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly track: TrackHandle<T>
  readonly snapshot: KeyframeSnapshot<T>
}
```

Los handles nunca permiten modificar directamente el snapshot:

```ts
// Incorrecto: snapshot inmutable
track.snapshot.keyframes[0].time = 2

// Correcto
timeline.editor.transaction((tx) => {
  tx.updateKeyframe(track.id, keyframe.id, {time: 2})
})
```

### Acceso por prop

```ts
const track = timeline.editor.getTrackFor(torus.props.rotation.x)
const keyframes = track?.getKeyframes() ?? []
```

Esto sustituye el acceso experimental a keyframes de Theatre.js por una API
pública y estable.

## 10. Edición y transacciones

```ts
interface TimelineEditor {
  readonly history: HistoryAPI

  transaction<Result = void>(
    callback: (tx: TimelineTransaction) => Result,
    options?: TransactionOptions,
  ): TransactionResult<Result>

  beginGesture(options?: GestureOptions): EditingGesture

  getTrackFor<T>(property: PropertyRef<T>): TrackHandle<T> | undefined
}
```

```ts
interface TransactionResult<Result> {
  readonly result: Result
  readonly changeSet: ChangeSet
}
```

### `transaction(callback)`

Ejecuta cambios de forma atómica y crea un único paso de undo.

```ts
timeline.editor.transaction((tx) => {
  tx.set(torus.props.rotation.x, 1)
  tx.set(torus.props.rotation.y, 0.5)
}, {label: 'Rotate torus'})
```

Si el callback lanza una excepción, la transacción se revierte y emite
`transaction:rollback`.

### TimelineTransaction

```ts
interface TimelineTransaction {
  set<T>(property: PropertyRef<T>, value: T): void
  unset(property: PropertyRef<unknown>): void

  sequence<T>(property: PropertyRef<T>): TrackHandle<T>
  unsequence(property: PropertyRef<unknown>): void

  addKeyframe<T>(
    trackId: string,
    keyframe: NewKeyframe<T>,
  ): KeyframeHandle<T>

  updateKeyframe<T>(
    trackId: string,
    keyframeId: string,
    patch: Partial<KeyframeData<T>>,
  ): void

  removeKeyframes(trackId: string, keyframeIds: readonly string[]): void
  moveKeyframes(selection: KeyframeSelection, deltaTime: number): void
  setInterpolation(
    selection: KeyframeSelection,
    interpolation: SegmentInterpolation,
  ): void

  setDuration(duration: number): void
  setFps(fps: number): void
}
```

### Semántica de `set(property, value)`

Para conservar la ergonomía de Theatre.js:

- Si la prop está secuenciada, crea o actualiza un keyframe en el playhead.
- Si no está secuenciada, modifica su static override.
- Las operaciones explícitas `addKeyframe()` y `updateKeyframe()` evitan esta
  decisión automática cuando el editor necesita control preciso.

### TransactionOptions

```ts
interface TransactionOptions {
  label?: string
  source?: EventSource
  history?: 'record' | 'ignore'
}
```

`history: 'ignore'` debe reservarse para cargas, migraciones o reparaciones
internas. La edición ordinaria siempre debe registrarse.

## 11. Gestos temporales

### `beginGesture(options)`

Crea una transacción temporal para drag, resize, edición de handles o value
scrubbing.

```ts
interface GestureOptions {
  label?: string
  source?: EventSource
}

interface EditingGesture {
  readonly id: string
  readonly active: boolean

  update(callback: (tx: TimelineTransaction) => void): void
  commit(): ChangeSet
  cancel(): void
}
```

Ejemplo de drag:

```ts
const gesture = timeline.editor.beginGesture({
  label: 'Move keyframe',
  source: 'user',
})

function onPointerMove(pointerX: number) {
  const time = snapToFrame(viewport.xToTime(pointerX), sequence.fps)

  gesture.update((tx) => {
    tx.updateKeyframe(trackId, keyframeId, {time})
  })
}

function onPointerUp() {
  gesture.commit()
}

function onEscape() {
  gesture.cancel()
}
```

Reglas:

- Cada `update()` sustituye la previsualización anterior del mismo gesto.
- Los listeners visuales pueden observar `document:preview`.
- `commit()` crea como máximo una entrada de historial.
- `cancel()` restaura exactamente el documento anterior al gesto.
- Un gesto cerrado no puede reutilizarse.
- No se permiten dos gestos de escritura simultáneos sobre el mismo timeline.

## 12. Selección e historial

### SelectionSnapshot

```ts
interface SelectionSnapshot {
  readonly objectIds: readonly string[]
  readonly trackIds: readonly string[]
  readonly keyframeIds: readonly string[]
  readonly markerIds: readonly string[]
  readonly primary?: SelectionRef
}
```

La selección pertenece a la sesión de edición de cada vista, no al documento de
animación ni al editor compartido. De esta manera dos vistas del mismo timeline
pueden mostrar diferentes rangos y selecciones sin interferir entre ellas.

```ts
interface TimelineEditorSession {
  readonly viewId: string
  readonly selection: SelectionSnapshot

  setSelection(selection: SelectionInput): void
  clearSelection(): void
}
```

```ts
view.editorSession.setSelection({
  keyframeIds: ['kf-1', 'kf-2'],
  primary: {type: 'keyframe', id: 'kf-2'},
})
```

### HistoryAPI

```ts
interface HistoryAPI {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel?: string
  readonly redoLabel?: string

  undo(): boolean
  redo(): boolean
  clear(): void
}
```

`undo()` y `redo()` modifican el documento mediante un `ChangeSet` con source
`undo` o `redo`, respectivamente.

## 13. Serialización

```ts
interface SerializeOptions {
  includeEditorState?: boolean
  pretty?: boolean
}

interface TimelineSerializer {
  serialize(timeline: Timeline, options?: SerializeOptions): TimelineDocument
  deserialize(input: unknown): TimelineDocument
}
```

### `timeline.serialize()`

Devuelve una copia JSON-compatible del documento. No incluye listeners, bindings,
handles, clock ni renderer.

### Importación de Theatre.js

Debe vivir en un adaptador independiente:

```ts
interface TheatreImporter {
  importProject(state: unknown): ImportResult
}

interface ImportResult {
  document: TimelineDocument
  warnings: readonly ImportWarning[]
}
```

El importador traduce concepts como:

```text
sheetsById          ──► compositions
tracksByObject      ──► tracks
trackIdByPropPath   ──► propertyPath
position            ──► time
connectedRight      ──► segment interpolation
handles             ──► incoming/outgoing Bezier handles
staticOverrides     ──► static values
```

## 14. Modelo general de eventos

La API usa eventos tipados y devuelve siempre una función de desuscripción.

```ts
type Unsubscribe = () => void

interface TimelineEventListenerOptions {
  signal?: AbortSignal
  once?: boolean
  scheduler?: 'sync' | 'animationFrame' | 'microtask'
}

timeline.on('sequence:position', (event) => {
  console.log(event.position)
})
```

### EventSource

Identifica el origen de una modificación:

```ts
type EventSource =
  | 'api'
  | 'user'
  | 'playback'
  | 'import'
  | 'undo'
  | 'redo'
  | 'system'
```

### EventEnvelope

Todos los eventos comparten metadatos:

```ts
interface EventEnvelope<Type extends string> {
  readonly type: Type
  readonly timelineId: string
  readonly timestamp: number
  readonly revision: number
  readonly source: EventSource
  readonly transactionId?: string
  readonly gestureId?: string
}
```

- `timestamp` es tiempo del reloj del sistema, no tiempo del playhead.
- `revision` es la revisión confirmada del documento.
- Los previews mantienen la revisión anterior hasta el commit.
- `transactionId` relaciona eventos producidos por una misma transacción.
- `gestureId` relaciona previews de un mismo gesto.

### TimelineEventMap

```ts
interface TimelineEventMap {
  'timeline:ready': TimelineReadyEvent
  'timeline:dispose': TimelineDisposeEvent

  'document:load': DocumentLoadEvent
  'document:replace': DocumentReplaceEvent
  'document:preview': DocumentPreviewEvent
  'document:change': DocumentChangeEvent

  'transaction:begin': TransactionBeginEvent
  'transaction:commit': TransactionCommitEvent
  'transaction:rollback': TransactionRollbackEvent

  'gesture:begin': GestureBeginEvent
  'gesture:update': GestureUpdateEvent
  'gesture:commit': GestureCommitEvent
  'gesture:cancel': GestureCancelEvent

  'composition:add': CompositionEvent
  'composition:remove': CompositionEvent
  'object:add': ObjectEvent
  'object:remove': ObjectEvent
  'object:valuesChange': ObjectValuesChangeEvent
  'track:add': TrackEvent
  'track:update': TrackEvent
  'track:remove': TrackEvent
  'keyframe:add': KeyframeEvent
  'keyframe:update': KeyframeEvent
  'keyframe:remove': KeyframeEvent

  'sequence:play': SequencePlayEvent
  'sequence:pause': SequencePauseEvent
  'sequence:stop': SequenceStopEvent
  'sequence:seek': SequenceSeekEvent
  'sequence:position': SequencePositionEvent
  'sequence:iteration': SequenceIterationEvent
  'sequence:end': SequenceEndEvent
  'timeline:snapshot': TimelineSnapshotEvent

  'history:change': HistoryChangeEvent
  'history:undo': HistoryEvent
  'history:redo': HistoryEvent

  warning: TimelineWarningEvent
  error: TimelineErrorEvent
}

interface TimelineViewEventMap {
  'view:mount': ViewMountEvent
  'view:unmount': ViewUnmountEvent
  'view:resize': ViewResizeEvent
  'viewport:change': ViewportChangeEvent
  'panel:resize': PanelResizeEvent
  'selection:change': SelectionChangeEvent
  'snap:change': SnapChangeEvent
}
```

Los eventos de `TimelineEventMap` pertenecen al documento, playback e historial
compartidos. Los de `TimelineViewEventMap` pertenecen exclusivamente a una vista.

## 15. Catálogo de eventos

### Eventos de ciclo de vida

| Evento | Se emite cuando | Frecuencia |
|---|---|---|
| `timeline:ready` | El documento y las composiciones están preparados. | Una vez. |
| `timeline:dispose` | El timeline libera sus recursos. | Una vez. |
| `document:load` | Se carga el documento inicial. | Una vez por carga. |
| `document:replace` | Se sustituye el documento completo. | Baja. |

```ts
interface TimelineReadyEvent extends EventEnvelope<'timeline:ready'> {
  readonly document: TimelineDocument
}

interface DocumentReplaceEvent extends EventEnvelope<'document:replace'> {
  readonly previousRevision: number
  readonly document: TimelineDocument
}
```

### Eventos de cambio del documento

| Evento | Se emite cuando | Historial |
|---|---|---|
| `document:preview` | Cambia el documento provisional durante un gesto. | No crea entrada. |
| `document:change` | Se confirma un cambio atómico. | Normalmente crea una entrada. |
| `transaction:begin` | Comienza una transacción. | Todavía sin cambios. |
| `transaction:commit` | Finaliza correctamente una transacción. | Una entrada como máximo. |
| `transaction:rollback` | La transacción falla y se restaura el estado. | Ninguna entrada. |
| `gesture:begin` | Comienza un gesto temporal. | Ninguna entrada. |
| `gesture:update` | Se actualiza la previsualización del gesto. | Ninguna entrada. |
| `gesture:commit` | Se confirma el gesto. | Una entrada como máximo. |
| `gesture:cancel` | Se cancela el gesto. | Ninguna entrada. |

```ts
interface ChangeRecord {
  readonly entity: 'composition' | 'object' | 'track' | 'keyframe' | 'sequence'
  readonly operation: 'add' | 'update' | 'remove'
  readonly id: string
  readonly parentId?: string
  readonly before?: unknown
  readonly after?: unknown
}

interface ChangeSet {
  readonly id: string
  readonly label?: string
  readonly revisionBefore: number
  readonly revisionAfter: number
  readonly changes: readonly ChangeRecord[]
}

interface DocumentChangeEvent extends EventEnvelope<'document:change'> {
  readonly changeSet: ChangeSet
  readonly document: TimelineDocument
}

interface DocumentPreviewEvent extends EventEnvelope<'document:preview'> {
  readonly preview: TimelineDocument
  readonly changes: readonly ChangeRecord[]
}
```

### Eventos de entidades

| Evento | Payload principal |
|---|---|
| `composition:add` | ID y snapshot de la composición. |
| `composition:remove` | ID y snapshot anterior. |
| `object:add` | Composition ID, object ID y schema. |
| `object:remove` | Composition ID y object ID. |
| `track:add` | Track snapshot. |
| `track:update` | Snapshot anterior y posterior. |
| `track:remove` | Track snapshot eliminado. |
| `keyframe:add` | Track ID y keyframe añadido. |
| `keyframe:update` | Track ID, valor anterior y posterior. |
| `keyframe:remove` | Track ID y keyframe eliminado. |

```ts
interface KeyframeEvent extends EventEnvelope<
  'keyframe:add' | 'keyframe:update' | 'keyframe:remove'
> {
  readonly compositionId: string
  readonly trackId: string
  readonly keyframeId: string
  readonly before?: KeyframeSnapshot
  readonly after?: KeyframeSnapshot
}
```

Los eventos granulares son una vista conveniente del `ChangeSet`. El evento
canónico de persistencia sigue siendo `document:change`.

### Eventos de valores evaluados

| Evento | Se emite cuando | Frecuencia |
|---|---|---|
| `object:valuesChange` | Cambia al menos una prop evaluada de un objeto. | Potencialmente por tick. |
| `timeline:snapshot` | Se produce un snapshot completo de reproducción. | Potencialmente por tick. |

```ts
interface ObjectValuesChangeEvent
  extends EventEnvelope<'object:valuesChange'> {
  readonly compositionId: string
  readonly objectId: string
  readonly time: number
  readonly values: Readonly<Record<string, TimelineValue>>
  readonly changedPaths: readonly PropertyPath[]
}

interface TimelineSnapshotEvent
  extends EventEnvelope<'timeline:snapshot'> {
  readonly compositionId: string
  readonly snapshot: TimelineSnapshot
}
```

`timeline:snapshot` es útil para bindings globales, depuración y render offline,
pero puede ser más costoso que suscribirse sólo a un objeto o prop.

### Eventos de reproducción

| Evento | Semántica exacta |
|---|---|
| `sequence:play` | La secuencia cambia a estado playing. |
| `sequence:pause` | Se pausa sin restablecer la posición. |
| `sequence:stop` | Se detiene mediante `stop()`. |
| `sequence:seek` | Se solicita un salto explícito del playhead. |
| `sequence:position` | La posición efectiva cambia por seek o playback. |
| `sequence:iteration` | Comienza una nueva iteración. |
| `sequence:end` | El playback termina naturalmente. |

```ts
interface SequencePositionEvent
  extends EventEnvelope<'sequence:position'> {
  readonly compositionId: string
  readonly previousPosition: number
  readonly position: number
  readonly delta: number
  readonly playing: boolean
}

interface SequenceSeekEvent extends EventEnvelope<'sequence:seek'> {
  readonly compositionId: string
  readonly from: number
  readonly requested: number
  readonly position: number
  readonly snapped: boolean
}

interface SequenceEndEvent extends EventEnvelope<'sequence:end'> {
  readonly compositionId: string
  readonly position: number
  readonly iterations: number
}
```

`sequence:pause` no se emite cuando la secuencia termina naturalmente; en ese caso
se emite `sequence:end`. `sequence:stop` sólo corresponde a una llamada explícita
a `stop()`.

### Eventos de selección e historial

| Evento | Se emite cuando |
|---|---|
| `selection:change` | Cambia la selección efectiva. |
| `history:change` | Cambia `canUndo`, `canRedo` o sus labels. |
| `history:undo` | Se aplica un undo. |
| `history:redo` | Se aplica un redo. |

```ts
interface SelectionChangeEvent extends ViewEventEnvelope<'selection:change'> {
  readonly previous: SelectionSnapshot
  readonly selection: SelectionSnapshot
}

interface HistoryChangeEvent extends EventEnvelope<'history:change'> {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel?: string
  readonly redoLabel?: string
}
```

### Eventos de viewport e interacción

| Evento | Se emite cuando | Pertenece a |
|---|---|---|
| `viewport:change` | Cambia el visible range o las dimensiones. | Estado ahistórico. |
| `snap:change` | Aparece, cambia o desaparece el snap activo. | Estado efímero. |

Estos eventos son producidos por una `TimelineView`, no por el evaluador de
animación ni por el bus de eventos compartido. Un renderer HTML y otro WebGL
pueden consumirlos de la misma manera sin compartir selección o viewport.

### Warnings y errores

```ts
interface TimelineWarningEvent extends EventEnvelope<'warning'> {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

interface TimelineErrorEvent extends EventEnvelope<'error'> {
  readonly code: string
  readonly message: string
  readonly error: Error
  readonly recoverable: boolean
}
```

Ejemplos de warning:

- Rango de playback recortado a la duración.
- Target sin binding activo.
- Prop importada con un tipo desconocido.
- Handle Bezier normalizado durante la carga.

Ejemplos de error:

- Documento inválido.
- ID duplicado.
- Track o keyframe inexistente.
- Tipo de valor incompatible.
- Uso de un handle después de `dispose()`.

## 16. Orden y frecuencia de los eventos

### Regla de atomicidad

Una transacción confirmada emite `document:change` exactamente una vez, aunque
contenga muchas operaciones.

Orden recomendado:

```text
transaction:begin
       │
       ├─ cambios internos
       │
       ▼
document:change             una vez
       │
       ▼
eventos granulares          track:update, keyframe:add, etc.
       │
       ▼
object:valuesChange         si cambia el valor evaluado actual
       │
       ▼
history:change              si cambia el historial
       │
       ▼
transaction:commit          último evento de la operación
```

Si la transacción falla:

```text
transaction:begin
       │
       ├─ error
       ▼
restaurar estado
       │
       ▼
transaction:rollback
```

No se emite `document:change` para una operación revertida.

### Orden durante playback

```text
tick del clock
      │
      ▼
sequence:position
      │
      ▼
object:valuesChange         cero o varios
      │
      ▼
timeline:snapshot           como máximo uno
```

### Seek

Un seek explícito emite:

```text
sequence:seek
      │
      ▼
sequence:position
      │
      ▼
object:valuesChange
      │
      ▼
timeline:snapshot
```

`sequence:seek` describe la intención; `sequence:position` describe el cambio
efectivo y también se utiliza durante playback.

### Gestos de alta frecuencia

Durante un drag:

```text
gesture:begin
document:preview + gesture:update    0..N veces
document:change                      0..1 vez
gesture:commit o gesture:cancel      1 vez
```

Los eventos `document:preview`, `gesture:update`, `sequence:position`,
`object:valuesChange` y `timeline:snapshot` son de alta frecuencia. Los listeners
deben poder solicitar scheduling por animation frame.

### Eventos síncronos

Por defecto, los eventos de comandos y transacciones son síncronos y se emiten
después de que el nuevo snapshot sea observable. Esto permite leer el estado
actual dentro del listener.

Los listeners con scheduler `animationFrame` o `microtask` pueden recibir eventos
coalescidos. El payload debe contener siempre el estado más reciente.

### Errores en listeners

Una excepción lanzada por un listener:

- No revierte una transacción ya confirmada.
- No detiene la reproducción.
- Se comunica al logger y, si es seguro, mediante el evento `error`.
- No impide que se invoquen los listeners restantes.

## 17. Ejemplo con Three.js

```ts
const timeline = createTimeline({
  id: 'three-scene',
  document: savedDocument,
})

const scene = timeline.composition('Animated scene')

const torus = scene.object('Torus Knot', {
  rotation: compound({
    x: numberProp(0, {range: [-2, 2]}),
    y: numberProp(0, {range: [-2, 2]}),
    z: numberProp(0, {range: [-2, 2]}),
  }),
  wireframe: booleanProp(false),
})

const unbind = torus.onValuesChange((values) => {
  mesh.rotation.set(
    values.rotation.x * Math.PI,
    values.rotation.y * Math.PI,
    values.rotation.z * Math.PI,
  )

  material.wireframe = values.wireframe
})

timeline.on('sequence:end', ({compositionId}) => {
  console.log(`Playback completed: ${compositionId}`)
})

await timeline.ready

void scene.sequence.play({
  iterationCount: Infinity,
  direction: 'normal',
})

// Limpieza
unbind()
timeline.dispose()
```

Edición programática:

```ts
const {result: track} = timeline.editor.transaction((tx) =>
  tx.sequence(torus.props.rotation.x),
)

timeline.editor.transaction((tx) => {
  tx.addKeyframe(track.id, {
    time: 0,
    value: 0,
    interpolation: {type: 'cubicBezier', controlPoints: [0.42, 0, 0.58, 1]},
  })

  tx.addKeyframe(track.id, {
    time: 3,
    value: 1,
    interpolation: {type: 'linear'},
  })
}, {label: 'Animate rotation X'})
```

## 18. Integración con un renderer

El renderer consume snapshots derivados y utiliza la API de edición para aplicar
interacciones:

```ts
interface TimelineRenderer {
  mount(container: HTMLElement): void
  render(model: TimelineRenderModel): void
  dispose(): void
}
```

```ts
const renderer = createHtmlTimelineRenderer()
renderer.mount(container)

const unsubscribe = projection.subscribe((renderModel) => {
  renderer.render(renderModel)
})
```

Un renderer WebGL utiliza el mismo contrato:

```ts
const renderer = createWebGLTimelineRenderer({canvas})

projection.subscribe((renderModel) => {
  renderer.render(renderModel)
})
```

El renderer no ejecuta mutaciones directas. Su controlador de interacción crea
comandos o gestos:

```text
Renderer
   │ pointer event / picking
   ▼
InteractionController
   │ xToTime + snapping
   ▼
EditingGesture / TimelineTransaction
   │
   ▼
TimelineStore
   │
   ▼
TimelineProjection
   │
   └────────► Renderer actualizado
```

## 19. Errores y validación

Se propone una jerarquía pública de errores:

```ts
class TimelineError extends Error {
  readonly code: string
  readonly details?: unknown
}

class InvalidDocumentError extends TimelineError {}
class InvalidArgumentError extends TimelineError {}
class EntityNotFoundError extends TimelineError {}
class DuplicateEntityError extends TimelineError {}
class IncompatibleValueError extends TimelineError {}
class TransactionError extends TimelineError {}
class GestureStateError extends TimelineError {}
class TimelineDisposedError extends TimelineError {}
```

Reglas:

- Los errores de programación lanzan excepciones.
- Las condiciones recuperables de runtime pueden emitir `warning`.
- Un callback de transacción que falla revierte todos sus cambios.
- La carga valida el documento completo antes de reemplazar el actual.
- Las APIs públicas nunca dejan keyframes desordenados.
- Los tiempos `NaN`, infinitos o negativos se rechazan o normalizan según una
  política documentada.

## 20. Versionado y compatibilidad

### Versión del documento

```ts
interface TimelineDocument {
  readonly schemaVersion: number
  // ...
}
```

El serializer debe rechazar versiones futuras desconocidas y migrar versiones
anteriores soportadas.

### Versión de la API

La API pública seguirá versionado semántico:

- Cambio incompatible: versión major.
- Nueva funcionalidad compatible: versión minor.
- Corrección compatible: versión patch.

Los nombres que comiencen por `experimental` no ofrecen estabilidad. Tracks y
keyframes deben formar parte de la API estable desde el momento en que la GUI los
utilice.

### Eventos

- Añadir un evento es un cambio compatible.
- Añadir un campo opcional a un payload es compatible.
- Eliminar o renombrar eventos o campos es incompatible.
- Los consumidores deben ignorar campos de payload que no conozcan.
- `EventEnvelope` debe mantenerse estable entre renderers.

## 21. Alcance recomendado

### API mínima inicial

Implementar primero:

- `createTimeline()` y `timeline.ready`.
- `composition()` y `object()`.
- Props numéricas, boolean y compound.
- `onValuesChange()` y bindings.
- `Sequence.position`, `play()`, `pause()` y `seek()`.
- Consulta estable de tracks y keyframes.
- `transaction()` y `beginGesture()`.
- Undo/redo.
- `serialize()` y carga validada.
- Eventos `document:change`, `sequence:*`, `object:valuesChange`,
  `history:*`, `warning` y `error`.
- `TimelineView.mount()`, `ResizeObserver` y eventos propios de cada vista.

### Segunda etapa

- Markers y event tracks.
- Playback alternado y rangos dinámicos.
- Reloj de audio.
- Copiar, pegar y escalar selecciones.
- Importador de Theatre.js.
- Coalescing y filtros avanzados de eventos.

### Extensiones futuras

- Varias composiciones enlazadas.
- Sheet instances.
- Colaboración en tiempo real.
- Patches incrementales para documentos grandes.
- Exportación offline.
- Plugins de tipos de props e interpoladores.

La API mínima debe implementarse mediante tests de contrato independientes del
renderer. El mismo conjunto de pruebas debe ejecutarse con un renderer HTML y uno
WebGL para confirmar que ambos producen comandos y eventos equivalentes.

## 22. Montaje, responsive y múltiples vistas

### Decisiones de diseño

- El contenedor indicado estará dedicado al timeline.
- La aplicación anfitriona controla su posición, anchura y altura.
- La vista ocupa el 100 % del contenedor.
- Un `ResizeObserver` detecta cualquier cambio de tamaño.
- Por debajo de las dimensiones mínimas aparece scroll; los controles no siguen
  comprimiéndose.
- Los divisores del árbol de tracks y graph editor son redimensionables.
- Un mismo `Timeline` puede tener varias vistas HTML o WebGL simultáneas.
- Cada vista conserva su propio viewport, layout, interacción y selección.
- Shadow DOM queda desactivado inicialmente, pero la arquitectura permitirá
  incorporarlo como opción.

### Aplicación anfitriona

La **aplicación anfitriona** es la web o aplicación que integra el timeline. Es
responsable de la escena Three.js, paneles, layout general, carga y guardado, ciclo
de vida y contenedor de montaje.

```html
<div id="application">
  <main id="three-viewport"></main>
  <aside id="properties-panel"></aside>
  <section id="timeline-container"></section>
</div>
```

```text
Aplicación anfitriona
├─ Viewport Three.js
├─ Panel de propiedades
└─ Contenedor dedicado
   └─ TimelineView
```

El timeline sólo controla el contenido de su elemento raíz dentro del contenedor.
No decide el layout exterior ni elimina otros nodos de la aplicación.

### API de creación y montaje

```ts
interface TimelineViewOptions {
  id: string
  timeline: Timeline
  renderer: 'html' | 'webgl' | TimelineRenderer
  sizing?: 'container'
  shadowDom?: false | 'open'
  minSize?: Partial<TimelineMinimumSize>
  panels?: Partial<TimelinePanelOptions>
}

interface TimelineMinimumSize {
  width: number
  height: number
  graphEditorHeight: number
}

interface TimelineView {
  readonly id: string
  readonly timeline: Timeline
  readonly mounted: boolean
  readonly container?: HTMLElement
  readonly editorSession: TimelineEditorSession

  mount(target: string | HTMLElement): void
  unmount(): void
  dispose(): void

  on<K extends keyof TimelineViewEventMap>(
    type: K,
    listener: (event: TimelineViewEventMap[K]) => void,
    options?: TimelineEventListenerOptions,
  ): Unsubscribe
}

function createTimelineView(options: TimelineViewOptions): TimelineView
```

Uso mediante selector:

```ts
const view = createTimelineView({
  id: 'main-timeline',
  timeline,
  renderer: 'html',
  sizing: 'container',
})

view.mount('#timeline-container')
```

También acepta una referencia directa:

```ts
const container = document.querySelector<HTMLElement>('#timeline-container')

if (container) view.mount(container)
```

Reglas de montaje:

- El selector se resuelve una sola vez a un `HTMLElement`.
- Si no encuentra ningún elemento, se lanza `MountTargetNotFoundError`.
- Si encuentra más de uno, se lanza `AmbiguousMountTargetError`.
- Una vista sólo puede estar montada en un contenedor simultáneamente.
- Para moverla debe llamarse primero a `unmount()`.
- `unmount()` retira observers y eventos, pero conserva la vista y su estado.
- `dispose()` destruye definitivamente la vista.
- El contenedor no puede estar ocupado por otra `TimelineView`.

### Sizing controlado por el contenedor

La opción inicial y única será:

```ts
sizing: 'container'
```

La aplicación anfitriona reserva una región y el timeline ocupa el 100 %. No se
calcula la altura a partir del número de tracks.

```css
#application {
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 320px;
}

#timeline-container {
  min-width: 0;
  min-height: 0;
  position: relative;
}
```

Una altura basada en contenido no forma parte de la primera versión porque puede
hacer crecer la página indefinidamente, mezclar el scroll del documento con el
del editor y provocar redimensiones continuas del canvas.

### ResizeObserver

La vista observa el contenedor, no `window`:

```text
Cambio de CSS, Grid, Flexbox o divisor
                 │
                 ▼
          ResizeObserver
                 │
                 ▼
        TimelineViewport
                 │
                 ▼
       TimelineProjection
                 │
          ┌──────┴──────┐
          ▼             ▼
        HTML          WebGL
```

Esto cubre cambios de ventana, orientación, fullscreen, paneles laterales y
divisores de la aplicación anfitriona.

Si el contenedor queda en `0 × 0`, la vista suspende el dibujo, conserva su estado
y reanuda automáticamente cuando vuelve a tener dimensiones positivas.

### Dimensiones mínimas

Defaults acordados, expresados en píxeles CSS:

```ts
const DEFAULT_TIMELINE_MINIMUM_SIZE: TimelineMinimumSize = {
  width: 640,
  height: 240,
  graphEditorHeight: 420,
}
```

- `640 px` permiten aproximadamente 180–220 px para el árbol y 420–460 px para
  el área temporal.
- `240 px` permiten toolbar, ruler, varias filas y scrollbar.
- Con el graph editor abierto, el mínimo vertical aumenta a `420 px`.
- El tamaño cómodo recomendado es `900 × 320 px`, o `900 × 480 px` con graph
  editor.

Por debajo del threshold, la superficie conserva su tamaño mínimo:

```text
Contenedor:        500 × 180
Superficie interna: 640 × 240
Resultado: scroll horizontal y vertical
```

```css
.k411-timeline-host {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.k411-timeline-root {
  width: max(100%, 640px);
  height: max(100%, 240px);
}
```

Los thresholds son configurables por vista, pero estos valores constituyen el
contrato y tema por defecto.

### Paneles redimensionables

```ts
interface TimelinePanelOptions {
  trackTree: {
    defaultWidth: number
    minWidth: number
    maxWidth: number
    maxRatio: number
    resizable: boolean
  }
  graphEditor: {
    defaultRatio: number
    minHeight: number
    maxRatio: number
    resizable: boolean
  }
}

const DEFAULT_TIMELINE_PANELS: TimelinePanelOptions = {
  trackTree: {
    defaultWidth: 240,
    minWidth: 160,
    maxWidth: 480,
    maxRatio: 0.45,
    resizable: true,
  },
  graphEditor: {
    defaultRatio: 0.4,
    minHeight: 120,
    maxRatio: 0.7,
    resizable: true,
  },
}
```

El máximo efectivo del árbol es el menor entre `480 px` y el 45 % de la anchura
interna. El cambio de tamaño de paneles pertenece al estado ahistórico de la vista
y no genera undo en el documento.

### Varias vistas del mismo timeline

```ts
const htmlView = createTimelineView({
  id: 'main-html',
  timeline,
  renderer: 'html',
})

const webglView = createTimelineView({
  id: 'overview-webgl',
  timeline,
  renderer: 'webgl',
})

htmlView.mount('#timeline-main')
webglView.mount('#timeline-overview')
```

Estado compartido:

- Documento, tracks y keyframes.
- Evaluador y bindings.
- Playback y playhead.
- Transacciones e historial.

Estado independiente por vista:

- Renderer y contenedor.
- Dimensiones y pixel ratio.
- Visible range, zoom y scroll.
- Tamaño de paneles y filas plegadas.
- Selección, hover, snapping y gesto visual.

```text
                     Timeline compartido
                 datos + playback + historial
                         │          │
             ┌───────────┘          └───────────┐
             ▼                                  ▼
      TimelineView HTML                 TimelineView WebGL
      zoom: [0, 5]                      zoom: [0, 30]
      panel: 240 px                     panel: 180 px
      selección propia                 selección propia
```

### HTML y WebGL

Ambos renderers reciben dimensiones lógicas comunes:

```ts
interface TimelineViewportSize {
  width: number
  height: number
  devicePixelRatio: number
}
```

En HTML, el elemento raíz ocupa el 100 % de la superficie interna. En WebGL se
distinguen tamaño CSS y framebuffer:

```ts
canvas.style.width = `${width}px`
canvas.style.height = `${height}px`

const pixelRatio = Math.min(window.devicePixelRatio, 2)
canvas.width = Math.round(width * pixelRatio)
canvas.height = Math.round(height * pixelRatio)
```

El pixel ratio no modifica los thresholds, que siempre están expresados en
píxeles CSS.

### Shadow DOM

Shadow DOM permite aislar el árbol DOM y los estilos internos del timeline de los
estilos de la aplicación anfitriona.

Ventajas:

- Evita interferencias de resets y selectores CSS globales.
- Impide que los estilos internos afecten al resto de la aplicación.
- Facilita distribuir la vista como un componente reutilizable.

Inconvenientes:

- El theming debe realizarse mediante CSS custom properties o `::part`.
- Popovers, portales y menús externos requieren mayor coordinación.
- Los eventos se retargetean al cruzar el límite del shadow tree.
- Puede complicar debugging, tests y librerías que esperan usar `document`.
- Aporta menos valor a un renderer compuesto principalmente por un canvas WebGL.

Decisión inicial:

```ts
shadowDom: false
```

La implementación utilizará clases prefijadas `.k411-timeline-*`, un reset local
y CSS custom properties. La opción futura `shadowDom: 'open'` se podrá añadir sin
cambiar el modelo ni la lógica.

### Eventos de vista

```ts
interface ViewEventEnvelope<Type extends string> {
  readonly type: Type
  readonly timelineId: string
  readonly viewId: string
  readonly timestamp: number
}

interface ViewResizeEvent extends ViewEventEnvelope<'view:resize'> {
  readonly width: number
  readonly height: number
  readonly devicePixelRatio: number
  readonly overflowX: boolean
  readonly overflowY: boolean
}

interface ViewportChangeEvent extends ViewEventEnvelope<'viewport:change'> {
  readonly reason: 'resize' | 'zoom' | 'pan' | 'programmatic'
  readonly visibleRange: readonly [number, number]
  readonly width: number
  readonly height: number
}

interface PanelResizeEvent extends ViewEventEnvelope<'panel:resize'> {
  readonly panel: 'trackTree' | 'graphEditor'
  readonly previousSize: number
  readonly size: number
}
```

`view:resize` describe las dimensiones físicas del contenedor. El evento
`viewport:change` describe el espacio temporal visible. Un resize puede producir
ambos eventos, pero un pan o zoom sólo produce `viewport:change`.
