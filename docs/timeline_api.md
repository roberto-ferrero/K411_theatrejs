# API y eventos de Timeline 411

Este documento propone el contrato público para crear, consultar, editar y
reproducir Timeline 411. La API toma como referencia la ergonomía de Theatre.js
0.7.2, utiliza su mismo modelo JSON de animación y mantiene desacopladas la lógica,
la interacción y la representación.

> Estado: contrato parcialmente implementado. Las secciones marcadas como
> objetivo describen la evolución prevista; el bloque siguiente enumera la API
> que existe y está probada a fecha de 2026-08-21.

### Estado de implementación del MVP HTML (2026-08-21)

La API de objetos y tracks ya está disponible. La entrada canónica es
`createTimeline()`; el constructor se conserva por compatibilidad:

```ts
const timeline = createTimeline({
  id: 'three-scene',
  state: theatreProjectState,
})

const composition = timeline.composition('Animated scene')
const sameComposition = timeline.sheet('Animated scene')

const torus = composition.object('Torus Knot', {
  rotation: {
    x: types.number(0, {range: [-2, 2]}),
    y: 0,
    z: 0,
  },
  wireframe: false,
})

torus.value
torus.props.rotation.x.get()
torus.onValuesChange(listener)
torus.bind(adapter)

const track = timeline.editor.getTrackFor(torus.props.rotation.x)
track?.snapshot
track?.getKeyframes()
track?.evaluate(1.5)

timeline.editor.transaction((transaction) => {
  transaction.set(torus.props.wireframe, true)
  transaction.sequence(torus.props.rotation.x)
  transaction.set(torus.props.rotation.x, 1)
}, {label: 'Animate torus'})

timeline.editor.history.undo()
timeline.editor.history.redo()

composition.sequence.play({loop: true})
composition.sequence.pause()
composition.sequence.seek(1.5)

timeline.document
timeline.firstSheetId
timeline.getDuration(sheetId)
timeline.getFps(sheetId)
timeline.evaluate(sheetId, time)
timeline.bindObject(sheetId, objectKey, defaults, apply)
timeline.serialize()
timeline.stringify(2)
timeline.on(eventName, listener)
timeline.dispose()

const view = new Timeline411HtmlView(timeline, sheetId)
view.mount('#timeline-411-html')
view.unmount()
view.on(eventName, listener)
view.dispose()
```

La transacción pública expone `set()`, `unset()`, `sequence()`, `unsequence()`,
`forgetObject()`, `addKeyframe()`, `addKeyframeAt()`, `updateKeyframe()`,
`removeKeyframe()`, `removeKeyframeAt()`, `setInterpolation()`, `setDuration()` y
`setFps()`. Todas las operaciones del callback forman un único cambio atómico y
un único paso de undo.

`TimelineStore` continúa exportado como API de bajo nivel para la GUI existente.
Incluye transacciones, gestos `preview/commit/cancel`, undo, redo y reemplazo de
documento, pero el código consumidor debe preferir `timeline.editor`.

Los tipos de props implementados son shorthand, `number`, `boolean`, `string`,
`stringLiteral`, `compound`, `rgba`, `image` y `file`. Los tipos simples admiten
interpoladores personalizados cuando corresponde.

La vista HTML muestra a la derecha de cada propiedad primitiva su valor evaluado
en el playhead. El control sigue estas reglas:

- Durante una interpolación es informativo y de solo lectura.
- Cuando el playhead coincide con un keyframe, permite editar el valor de ese
  keyframe mediante una transacción reversible.
- Una propiedad no secuenciada permite editar su static override.
- Seleccionar, crear o arrastrar un keyframe sincroniza el playhead con él.
- `Enter` o blur confirman; `Escape` cancela.
- Los números se muestran con un máximo de tres decimales. El modelo conserva la
  precisión introducida por el usuario.

El viewport temporal también está implementado como estado independiente de la
vista. Empieza encajando toda la secuencia y ofrece zoom focal, pan, rango
visible, fit y sincronización con la scrollbar HTML. Dos vistas del mismo
timeline no comparten viewport.

La duración total se edita en la toolbar. El campo acepta un número finito mayor
que cero, confirma con `Enter` o blur y cancela con `Escape`. La modificación usa
`timeline.editor.transaction()` y, por tanto, participa en undo/redo. Presenta
tres decimales sin reducir la precisión guardada. Los keyframes posteriores a
una reducción de duración no se eliminan.

La toolbar se divide en tres zonas. El bloque básico contiene nombre,
Play/Pause, posición del playhead y duración. El grupo derecho contiene
`Deshacer`, `Rehacer` y `JSON`. Entre ambos sólo aparece el bloque enmarcado
`KF seleccionado` cuando existe exactamente un keyframe seleccionado.

El bloque contextual permite cambiar el tiempo con `Enter` o blur; `Escape`
cancela. El valor se ajusta al frame más cercano, debe permanecer dentro de
`[0, duración]` y no puede coincidir con otro keyframe del mismo track. Una
edición válida usa `updateKeyframe()` dentro de una transacción reversible y
mueve el playhead al nuevo tiempo. Mover el playhead por separado no elimina la
selección. Sin selección, el bloque contextual se oculta completamente.

El selector contextual muestra siempre el easing saliente efectivo: `Linear`,
`Hold`, `Ease`, `Ease In`, `Ease Out` o `Ease In Out`. Los segmentos nuevos usan
`Linear` de forma predeterminada. Cuando unos handles importados no coinciden con
un preset, muestra `Curva importada` como estado informativo; elegir un preset
los reemplaza, pero mientras tanto el JSON se conserva intacto. Para el último
keyframe muestra `Sin segmento` y queda deshabilitado.

Cada fila de propiedad primitiva incluye un rombo `◇/◆` para añadir o quitar un
keyframe en el playhead. El doble clic sobre la lane aplica la misma operación en
el tiempo apuntado. La primera alta sobre una propiedad estática crea el track;
también se puede poblar un track vacío. Al quitar el último keyframe, la vista
des-secuencia el track y conserva el valor evaluado como static override. Estas
reglas se implementan en el editor y pueden reutilizarse desde HTML o WebGL.

Un clic sencillo con el botón izquierdo sobre el fondo temporal o una lane
vacía deselecciona el keyframe activo sin mover el playhead. El bloque
contextual de `KF` se oculta y la vista emite `selection:change`. Los keyframes,
el ruler, el playhead y los gestos de pan o drag quedan excluidos; el doble clic
de creación continúa funcionando.

La vista admite selección múltiple con `Ctrl/Cmd + clic`. Un clic simple
reemplaza el grupo y el último keyframe añadido actúa como principal. Arrastrar
cualquiera de los seleccionados mueve todo el grupo conservando sus offsets; el
delta se limita al rango de la secuencia y al primer keyframe no seleccionado de
cada track. `Delete` o `Backspace` eliminan el grupo. Cada movimiento o borrado
se registra como una única operación de undo/redo. Si el lote elimina todas las
claves de un track, el editor lo des-secuencia y conserva su valor estático. Con
más de un keyframe, el bloque contextual se oculta.

Si un keyframe coincide con la línea vertical del playhead, el keyframe tiene
prioridad de puntero. La vista HTML lo apila por encima de la línea, muestra
cursor de mano y reserva `ew-resize` para el ruler y el handle superior del
playhead. La línea que atraviesa las propiedades es sólo visual y utiliza
`pointer-events: none`; no permite mover el playhead desde las filas. El drag del
keyframe actualiza su tiempo con snapping y desplaza simultáneamente el playhead.

Eventos del núcleo implementados:

- `document:change` y `document:preview`.
- `history:change`.
- `sequence:position`, `sequence:play` y `sequence:pause`.

Eventos propios de cada vista implementados:

- `selection:change`.
- `view:resize`.
- `viewport:change`.
- `panel:resize`.

Permanecen como evolución posterior el playback avanzado, sheet instances con
playheads independientes, los sobres de eventos enriquecidos y el renderer
WebGL. El detalle actualizado se mantiene en
[`timeline411_TODO.md`](./timeline411_TODO.md).

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
- Cargar estados exportados por Theatre.js 0.7.2 directamente.
- Exportar un JSON que Theatre.js 0.7.2 pueda cargar sin ningún adaptador.

La API no debe obligar a utilizar:

- React ni otro framework de UI.
- DOM, SVG, Canvas o WebGL.
- Three.js como modelo interno.
- `requestAnimationFrame` como única fuente de tiempo.

### Requisito de compatibilidad directa

El estado de animación canónico de Timeline 411 es el `ProjectState` utilizado por
Theatre.js 0.7.2. Esta equivalencia es un requisito, no una operación opcional de
importación o exportación:

```ts
const state = timeline411.serialize()

// Debe funcionar directamente, sin conversión.
const project = getProject('Timeline 411 export', {state})
```

El JSON de animación no puede contener claves exclusivas de Timeline 411. Zoom,
scroll, selección, paneles y configuración de vistas se guardan en un documento
de editor separado.

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
```

## 4. Creación del timeline

### `createTimeline(config)`

Crea el contenedor principal.

```ts
interface CreateTimelineConfig {
  id: string
  document?: unknown
  state?: unknown
  clock?: AnimationClock
  idFactory?: (prefix: string) => string
}

function createTimeline(config: CreateTimelineConfig): Timeline411
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
- `document` y `state` son alias mutuamente excluyentes. Si se omiten se crea
  un documento vacío válido.
- `clock` puede ser RAF, audio o un reloj determinista.
- `idFactory` permite generar IDs reproducibles durante tests.
- La creación no debe montar ninguna GUI.
- `new Timeline411(theatreProjectState)` sigue disponible como wrapper de
  compatibilidad.

## 5. Timeline

```ts
interface Timeline411 {
  readonly id: string
  readonly ready: Promise<void>
  readonly editor: TimelineEditor

  get document(): TimelineDocument
  get revision(): number

  composition(id: string): Composition
  sheet(id: string): Composition
  getComposition(id: string): Composition | undefined
  getCompositions(): readonly Composition[]

  getDuration(sheetId: string): number
  getFps(sheetId: string): number
  getPlayer(sheetId: string): TimelinePlayer
  evaluate(sheetId: string, time: number): EvaluatedSheet
  serialize(): TheatreProjectState
  replaceDocument(document: TimelineDocument): void

  on<K extends keyof TimelineEventMap>(
    type: K,
    listener: (event: TimelineEventMap[K]) => void,
    options?: TimelineEventListenerOptions,
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

### `evaluate(sheetId, time)`

Evalúa el documento sin cambiar el playhead:

```ts
const snapshot = timeline.evaluate('Animated scene', 1.5)
const rotationX = snapshot.objects['Torus Knot'].rotation.x
```

Esto permite generar thumbnails, exportar frames o inspeccionar valores sin
interrumpir el playback.

### `replaceDocument(document)`

Reemplaza el documento completo después de validarlo, pausa los players activos,
vacía el historial y emite un cambio de tipo `replace`. Los handles consultan el
documento actual por dirección; si su entidad desapareció, su snapshot falla de
forma explícita.

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
    listener: (values: ValuesOf<Props>) => void,
    options?: ValueSubscriptionOptions,
  ): Unsubscribe

  bind(
    adapter:
      | ObjectBindingAdapter<ValuesOf<Props>>
      | ((values: ValuesOf<Props>) => void),
  ): Unsubscribe

  detach(): void
}
```

### `props`

Árbol de referencias tipadas. Las referencias identifican props; no contienen el
valor mutable directamente.

```ts
interface PropertyRef<T> {
  readonly object: TimelineObject
  readonly path: readonly string[]
  readonly config: PropType<T>
  readonly address: PropertyAddress

  get(): T
  onChange(listener: (value: T) => void): Unsubscribe
  getLeafRefs(): readonly PropertyRef[]
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

Reglas implementadas:

- Invoca una vez al suscribirse, salvo `emitCurrent: false`.
- Sólo vuelve a invocar si al menos una prop cambia semánticamente.
- Durante playback puede ejecutarse una vez por tick del reloj.
- Devuelve una función de desuscripción idempotente.
- El listener se ejecuta síncronamente; el consumidor debe capturar sus propios
  errores en esta versión.

```ts
interface ValueSubscriptionOptions {
  emitCurrent?: boolean
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

Contrato implementado:

```ts
interface TimelineSequence {
  readonly composition: Composition
  readonly length: number
  readonly fps: number
  readonly playing: boolean

  get position(): number
  set position(value: number)

  play(options?: {loop?: boolean}): void
  pause(): void
  seek(position: number): void

  subscribe(
    listener: (state: PlaybackState) => void,
    emitCurrent?: boolean,
  ): Unsubscribe
}
```

### `position`

Tiempo del playhead en segundos. Asignar `position` equivale a `seek(value)`.
La posición se restringe al rango `[0, duration]`.

### `play(options)`

Inicia o reinicia playback. `loop` vale `true` por defecto.

```ts
scene.sequence.play({loop: true})
```

Los rangos, rate, reverse/alternate, iteration count, `PlaybackResult` asíncrono
y `stop()` pertenecen al TODO de playback completo.

### `pause()`

Detiene el avance sin cambiar la posición.

### `stop()`

Objetivo todavía no implementado: detener el avance y elegir dónde queda el
playhead.

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
  readonly objectKey: string
  readonly propertyPath: PropertyPath
  readonly keyframes: readonly KeyframeSnapshot<T>[]
}

interface KeyframeSnapshot<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly position: number
  readonly value: T
  readonly handles: readonly [number, number, number, number]
  readonly connectedRight: boolean
  readonly type?: 'bezier' | 'hold'
}

interface TrackHandle<T extends TimelineValue = TimelineValue> {
  readonly id: string
  readonly composition: Composition
  readonly property: PropertyRef<T> | undefined
  readonly snapshot: TrackSnapshot<T>

  getKeyframe(id: string): KeyframeHandle<T> | undefined
  getKeyframes(): readonly KeyframeHandle<T>[]
  evaluate(time: number): T | undefined
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
track.snapshot.keyframes[0].position = 2

// Correcto
timeline.editor.transaction((tx) => {
  tx.updateKeyframe(keyframe, {position: 2})
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
  ): Result

  getTrackFor<T>(property: PropertyRef<T>): TrackHandle<T> | undefined
  forgetObject(
    object: TimelineObject | ObjectAddress,
    options?: TransactionOptions,
  ): void
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

Si el callback lanza una excepción, el draft se descarta y no se añade una
entrada al historial. Los change sets y el evento `transaction:rollback`
permanecen pendientes.

### TimelineTransaction

```ts
interface TimelineTransaction {
  set<T>(property: PropertyRef<T>, value: T): void
  unset(property: PropertyRef<unknown>): void

  sequence<T>(property: PropertyRef<T>): TrackHandle<T>
  unsequence(property: PropertyRef<unknown>): void

  addKeyframe<T>(
    track: TrackHandle<T>,
    keyframe: NewKeyframe<T>,
  ): KeyframeHandle<T>

  addKeyframeAt<T>(
    property: PropertyRef<T> | PropertyAddress,
    options: {position: number; value?: T},
  ): KeyframeAddress

  updateKeyframe(keyframe: KeyframeHandle | KeyframeAddress, patch: KeyframePatch): void
  removeKeyframe(
    keyframe: KeyframeHandle | KeyframeAddress,
    options?: {unsequenceIfEmpty?: boolean},
  ): void
  removeKeyframeAt(
    property: PropertyRef<unknown> | PropertyAddress,
    position: number,
    options?: {unsequenceIfEmpty?: boolean},
  ): KeyframeAddress | undefined
  setInterpolation(
    keyframe: KeyframeHandle | KeyframeAddress,
    preset: 'linear' | 'hold' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut',
  ): void

  forgetObject(object: TimelineObject | ObjectAddress): void
  setDuration(sheetId: string, duration: number): void
  setFps(sheetId: string, fps: number): void
}
```

### Semántica de `set(property, value)`

Para conservar la ergonomía de Theatre.js:

- Si la prop está secuenciada, crea o actualiza un keyframe en el playhead.
- Si no está secuenciada, modifica su static override.
- Las operaciones explícitas `addKeyframe()` y `updateKeyframe()` evitan esta
  decisión automática cuando el editor necesita control preciso.

### Semántica de `addKeyframeAt()` y `removeKeyframeAt()`

- La posición se ajusta al frame más cercano y debe quedar dentro de la
  duración.
- `addKeyframeAt()` crea el track si no existe y usa el valor evaluado cuando no
  recibe `value`.
- Puede recibir una referencia tipada o una `PropertyAddress`, lo que permite a
  un controlador renderer-neutral operar sin depender del DOM.
- `removeKeyframeAt()` no hace nada si no existe una clave en ese frame.
- Por defecto, quitar el último keyframe elimina el track y conserva el valor
  evaluado como static override. `{unsequenceIfEmpty: false}` permite conservar
  deliberadamente un track vacío desde APIs de bajo nivel.

### TransactionOptions

```ts
interface TransactionOptions {
  label?: string
}
```

Toda edición pública se registra en el historial. Las opciones de source y de
ignorar historial permanecen como evolución futura.

## 11. Gestos temporales

### `timeline.store.beginGesture(label)`

Crea una transacción temporal de bajo nivel para drag, resize, edición de
handles o value scrubbing. Su traslado a `timeline.editor.beginGesture()` está
pendiente.

```ts
interface EditingGesture {
  readonly active: boolean

  update(callback: (tx: StoreTransaction) => void): void
  commit(): void
  cancel(): void
}
```

Ejemplo de drag:

```ts
const gesture = timeline.store.beginGesture('Move keyframe')

function onPointerMove(pointerX: number) {
  const time = snapToFrame(viewport.xToTime(pointerX), sequence.fps)

  gesture.update((tx) => {
    tx.updateKeyframe(keyframeAddress, {position: time})
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

### Selección de keyframes implementada

El estado básico es renderer-neutral y se exporta desde el paquete. La vista
HTML lo consume, pero no contiene referencias al DOM:

```ts
interface TimelineKeyframeSelectionSnapshot {
  /** Alias compatible: keyframe principal. */
  readonly selection?: KeyframeAddress
  /** Grupo completo en orden de selección. */
  readonly selections: readonly KeyframeAddress[]
}

class TimelineKeyframeSelection {
  readonly size: number
  readonly primary?: KeyframeAddress
  readonly values: readonly KeyframeAddress[]
  readonly snapshot: TimelineKeyframeSelectionSnapshot

  has(address: KeyframeAddress): boolean
  replace(address?: KeyframeAddress): boolean
  toggle(address: KeyframeAddress): boolean
  makePrimary(address: KeyframeAddress): boolean
  retain(predicate: (address: KeyframeAddress) => boolean): boolean
  clear(): boolean
}
```

La vista expone una copia del estado vigente mediante `view.selection` y emite
el mismo payload cuando cambia:

```ts
const current = view.selection

view.on('selection:change', ({selection, selections}) => {
  console.log('principal', selection)
  console.log('grupo', selections)
})
```

`selection` se conserva para consumidores escritos durante la fase de selección
simple. `selections` es la fuente para operaciones de grupo. Ninguno de estos
datos se serializa en `animation.json`.

### SelectionSnapshot ampliado (objetivo)

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
type TimelineDocument = TheatreProjectState

interface TheatreProjectState {
  sheetsById: Record<string, TheatreSheetState>
  definitionVersion: '0.4.0'
  revisionHistory: string[]
}

interface TheatreSheetState {
  staticOverrides: {
    byObject: Record<string, SerializableMap>
  }
  sequence?: TheatreSequenceState
}

interface TheatreSequenceState {
  type: 'PositionalSequence'
  length: number
  subUnitsPerUnit: number
  tracksByObject: Record<string, TheatreObjectTracksState>
}

interface TheatreObjectTracksState {
  trackData: Record<string, TheatreBasicKeyframedTrack>
  trackIdByPropPath: Record<string, string>
}

interface TheatreBasicKeyframedTrack {
  type: 'BasicKeyframedTrack'
  __debugName?: string
  keyframes: TheatreKeyframe[]
}

interface TheatreKeyframe {
  id: string
  position: number
  connectedRight: boolean
  handles: [number, number, number, number]
  value: SerializableValue
  type?: 'bezier' | 'hold'
}

interface TimelineSerializer {
  serialize(timeline: Timeline): TheatreProjectState
  stringify(timeline: Timeline, options?: {space?: number}): string
  deserialize(input: unknown): TimelineDocument
}
```

### `timeline.serialize()`

Devuelve una copia del estado de proyecto directamente compatible con Theatre.js
0.7.2. No incluye listeners, bindings, handles de API, clock, renderer ni estado de
la interfaz.

Las claves y valores deben conservar el significado exacto de Theatre.js:

```text
sheetsById
└─ <sheetId>
   ├─ staticOverrides.byObject
   └─ sequence
      ├─ type: "PositionalSequence"
      ├─ length
      ├─ subUnitsPerUnit
      └─ tracksByObject
         └─ <objectKey>
            ├─ trackIdByPropPath
            └─ trackData
               └─ <trackId>
                  ├─ type: "BasicKeyframedTrack"
                  └─ keyframes[]
```

Reglas de compatibilidad:

- `definitionVersion` será `"0.4.0"`, que es la versión del formato utilizado por
  Theatre.js 0.7.2.
- Los IDs de tracks, keyframes y revisiones deben ser estables y únicos.
- `trackIdByPropPath` utiliza paths codificados con `JSON.stringify(path)`.
- Los keyframes se ordenan por `position`.
- Los handles mantienen el orden `[incomingX, incomingY, outgoingX, outgoingY]`.
- El segmento A→B utiliza el handle de salida de A y el de entrada de B.
- `connectedRight`, `type`, `position` y `value` conservan la semántica de
  Theatre.js.
- El serializer no renombra `Sheet` como `Composition` dentro del JSON.
- No se añaden campos de Timeline 411, aunque parezcan inocuos.

### Carga de un estado de Theatre.js

No existe una fase de traducción. `deserialize()` valida el mismo modelo y lo
utiliza como documento canónico:

```ts
const response = await fetch('/animation.json')
const theatreState: unknown = await response.json()

const document = serializer.deserialize(theatreState)
const timeline = createTimeline({id: 'scene', document})
```

### Estado propio del editor

La información visual se guarda separada para no invalidar la compatibilidad:

```ts
interface Timeline411EditorState {
  readonly version: 1
  readonly views: Readonly<Record<string, Timeline411ViewState>>
}

interface Timeline411ViewState {
  readonly viewport: {
    readonly visibleRange: readonly [number, number]
    readonly mode: 'fit' | 'manual'
  }
  // Futuro: paneles, filas plegadas, Focus Range y Graph Editor.
}
```

Persistencia recomendada:

```text
animation.json              ProjectState compatible con Theatre.js 0.7.2
timeline411.editor.json     Vistas, zoom, scroll, paneles y filas plegadas
```

La selección, hover, drag y snap activo son efímeros y no necesitan guardarse.

### Definición de props y bindings

Como ocurre en Theatre.js, el `ProjectState` no contiene por sí solo todo el
schema de props ni las referencias a meshes. La aplicación continúa declarando
los objetos y sus bindings en código:

```ts
const torus = composition.object('Torus Knot', {
  rotation: compound({
    x: numberProp(0),
    y: numberProp(0),
    z: numberProp(0),
  }),
  wireframe: booleanProp(false),
})

torus.bind(threeTorusBinding)
```

Los IDs de sheet, object y property path declarados en código deben coincidir con
los del JSON para que sus tracks se resuelvan correctamente.

### Prueba de compatibilidad obligatoria

Cada versión del serializer debe superar al menos estas pruebas:

1. Crear y editar una animación con Timeline 411.
2. Serializar su `TheatreProjectState`.
3. Pasarlo directamente a `getProject(uniqueId, {state})` de Theatre.js 0.7.2.
4. Declarar los mismos objects y props.
5. Verificar duración, keyframes, easing y valores evaluados.
6. Cargar un estado exportado por Theatre.js en Timeline 411, volver a guardarlo y
   comprobar que Theatre.js sigue aceptándolo.

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

El sobre anterior es el objetivo ampliado para selecciones heterogéneas. El
evento implementado actualmente para keyframes utiliza directamente
`TimelineKeyframeSelectionSnapshot`: `selection` contiene el principal y
`selections` el grupo completo. Aún no incluye `previous` ni un envelope común.

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

scene.sequence.play({loop: true})

// Limpieza
unbind()
timeline.dispose()
```

Edición programática:

```ts
const track = timeline.editor.transaction((tx) =>
  tx.sequence(torus.props.rotation.x),
)

timeline.editor.transaction((tx) => {
  const first = tx.addKeyframe(track, {
    position: 0,
    value: 0,
  })

  tx.addKeyframe(track, {
    position: 3,
    value: 1,
  })

  tx.setInterpolation(first, 'easeInOut')
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
type TimelineDocument = TheatreProjectState

interface TheatreProjectState {
  sheetsById: Record<string, TheatreSheetState>
  definitionVersion: '0.4.0'
  revisionHistory: string[]
}
```

Timeline 411 no introduce un `schemaVersion` propio dentro del documento de
animación. Debe respetar `definitionVersion` y las estructuras esperadas por
Theatre.js 0.7.2.

Si en el futuro se soportan otras versiones de Theatre.js, la aplicación deberá
seleccionar explícitamente el codec correspondiente. Nunca se migrará
silenciosamente un archivo y se presentará como compatible con 0.7.2 sin superar
las pruebas de carga directa.

El sidecar `Timeline411EditorState` sí tiene su propia versión porque no se entrega
a Theatre.js.

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

- [x] `createTimeline()` y `timeline.ready`.
- [x] `composition()`, `sheet()` y `object()`.
- [x] Todos los tipos de props acordados e interpoladores personalizados.
- [x] `onValuesChange()` y bindings.
- [x] `Sequence.position`, `play()`, `pause()` y `seek()`.
- [x] Consulta estable de tracks y keyframes.
- [x] `timeline.editor.transaction()` y gestos en el store de bajo nivel.
- [x] Undo/redo.
- [x] `serialize()` y carga validada en Theatre.js 0.7.2.
- [x] Eventos básicos `document:*`, `history:change` y `sequence:*`.
- [x] `Timeline411HtmlView.mount()`, `ResizeObserver` y eventos de vista.
- [ ] Sobres de eventos, `warning`, `error`, eventos detallados de objetos y
      transacciones.
- [ ] Promover los gestos de edición desde el store a `timeline.editor`.

### Segunda etapa

- Markers y event tracks.
- Playback alternado y rangos dinámicos.
- Reloj de audio.
- Copiar, pegar y escalar selecciones.
- Persistencia del sidecar visual de Timeline 411.
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

### API de viewport implementada

`Timeline411HtmlView` expone una instancia independiente de `TimelineViewport`:

```ts
const view = new Timeline411HtmlView(timeline, sheetId)

view.viewport.snapshot
view.viewport.setVisibleRange(2, 8)
view.viewport.zoomAt(4, 1.5)
view.viewport.panBy(0.5)
view.viewport.fitToSequence()
view.viewport.onChange((change) => {
  console.log(change.reason, change.snapshot.visibleRange)
})
```

```ts
interface TimelineViewportSnapshot {
  readonly visibleStart: number
  readonly visibleEnd: number
  readonly visibleRange: readonly [number, number]
  readonly duration: number
  readonly fps: number
  readonly width: number
  readonly zoom: number
  readonly mode: 'fit' | 'manual'
}
```

Interacciones HTML implementadas:

- `Ctrl/Cmd + rueda`: zoom alrededor del cursor.
- Trackpad horizontal o `Shift + rueda`: pan.
- `Espacio + drag` o botón central: pan por arrastre.
- `F` o doble clic en el ruler: fit de la secuencia completa.
- Scrollbar horizontal nativa sincronizada con el visible range.

El evento de vista contiene el snapshot mínimo necesario para sincronizar otros
componentes de la aplicación anfitriona:

```ts
interface ViewportChangeEvent {
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly visibleRange: readonly [number, number]
  readonly zoom: number
  readonly reason:
    | 'zoom'
    | 'pan'
    | 'scroll'
    | 'resize'
    | 'fit'
    | 'programmatic'
    | 'duration'
}
```

El estado permanece en memoria y pertenece a la vista. Su futura persistencia se
realizará dentro de `timeline411.editor.json`, nunca dentro de
`animation.json`.

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
