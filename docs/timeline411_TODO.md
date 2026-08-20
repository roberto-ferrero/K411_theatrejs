# Timeline 411: decisiones, funcionalidades y TODO

Última actualización: 2026-08-20

## Propósito

Este documento mantiene el contexto de evolución de Timeline 411. Separa las
decisiones consolidadas, las funcionalidades terminadas, el trabajo activo y los
pendientes necesarios para aproximarse al editor de secuencias de Theatre.js
0.7.2 sin acoplar el núcleo a HTML o WebGL.

## Decisiones consolidadas

### Arquitectura general

- El estado canónico de animación es el `ProjectState` de Theatre.js 0.7.2.
- `animation.json` debe poder cargarse mediante `getProject(id, {state})` sin
  adaptador.
- El estado visual del editor nunca se mezcla con el `ProjectState`.
- Datos, evaluación, reproducción, edición y representación son capas separadas.
- La interfaz actual usa HTML, CSS y SVG; WebGL permanece inactivo.
- La GUI se monta en un contenedor dedicado, ocupa el 100 % y conserva una
  superficie mínima de `640 × 240 px` con scroll por debajo de ese tamaño.
- Shadow DOM permanece desactivado.

### Decisiones de la API de objetos y tracks

1. La API canónica utiliza `createTimeline().composition().object()` y expone
   `sheet()` como alias familiar de Theatre.js.
2. Se soportan los tipos de propiedades de Theatre.js 0.7.2: shorthand,
   `number`, `boolean`, `string`, `stringLiteral`, `compound`, `rgba`, `image` y
   `file`, además de interpoladores personalizados donde Theatre los admite.
3. Se soportan varias sheets/compositions. Las sheet instances con playheads
   independientes se posponen a la fase de playback completo.
4. La edición pública se realiza mediante `timeline.editor.transaction()` con
   `set`, `unset`, `sequence` y `unsequence`. `TimelineStore` permanece como API
   interna o de bajo nivel.
5. Se conserva compatibilidad con `new Timeline411(state)`, `timeline.player`,
   `bindObject()` y la GUI HTML existente.
6. `detachObject()` desconecta un handle sin borrar animación;
   `editor.forgetObject()` elimina overrides y tracks mediante una transacción
   reversible.

## Funcionalidades completadas

### Modelo y compatibilidad

- [x] Modelo JSON compatible con Theatre.js 0.7.2.
- [x] Validación de sheets, sequences, tracks, keyframes, handles y property
      paths.
- [x] Exportación de `animation.json` sin estado visual.
- [x] Prueba que carga directamente el JSON exportado en Theatre.js 0.7.2.
- [x] Historial de IDs de revisión limitado a 50 entradas.

### Runtime

- [x] Evaluación de tracks mediante búsqueda binaria.
- [x] Segmentos Bezier, Hold y desconexión derecha.
- [x] Evaluación de static overrides y valores por defecto.
- [x] Player básico con play, pause, seek y loop.
- [x] Bindings desacoplados, incluido el torus Three.js.
- [x] Eventos básicos de documento, historial y reproducción.

### Store y edición inicial

- [x] Transacciones atómicas.
- [x] Gestos temporales con preview, commit y cancel.
- [x] Undo y redo.
- [x] Alta, modificación, movimiento y borrado de keyframes.
- [x] Presets Linear, Hold, Ease, Ease In, Ease Out y Ease In Out.

### GUI HTML/SVG

- [x] Toolbar, árbol de propiedades, ruler, grid, lanes y playhead.
- [x] Diseño responsive y panel de tracks redimensionable.
- [x] Selección individual.
- [x] Drag de playhead y keyframes con snapping a frames.
- [x] Alta por doble click y borrado con `Delete`.
- [x] Exportación manual.

## API de objetos y tracks completada (2026-08-20)

- [x] `createTimeline()` con configuración y documento vacío válido.
- [x] `composition()` y alias `sheet()`.
- [x] `TimelineObject`, schemas de props y referencias tipadas.
- [x] Shorthand y tipos `number`, `boolean`, `string`, `stringLiteral`,
      `compound`, `rgba`, `image` y `file`.
- [x] Interpoladores personalizados para tipos simples.
- [x] `object.value`, `initialValue`, `onValuesChange()` y `bind()`.
- [x] Handles estables de tracks y keyframes.
- [x] Consulta pública por composición, objeto y propiedad.
- [x] `timeline.editor.transaction()` con composición atómica de operaciones.
- [x] `set`, `unset`, `sequence`, `unsequence` y `forgetObject`.
- [x] Alta, modificación, borrado e interpolación de keyframes desde el editor.
- [x] Varias compositions con reproducción independiente por sheet.
- [x] Diferenciación entre `detachObject()` y `forgetObject()`.
- [x] Wrappers compatibles con la API anterior.
- [x] El binding del torus usa la API canónica nueva.
- [x] Tests de contrato de la nueva API y de los tipos de propiedades.
- [x] Prueba de un documento creado desde cero con Timeline 411 y cargado sin
      adaptador en Theatre.js 0.7.2.

La suite al cerrar este bloque contiene 24 pruebas. `npm test` y
`npm run build` finalizan correctamente.

## TODO pendiente después de la API de objetos y tracks

### Playback completo

- [ ] Rangos, rate, reverse, alternate e iteration count.
- [ ] Resultado asíncrono de reproducción, stop y final natural.
- [ ] RAF driver configurable desde la fachada.
- [ ] Navegación frame a frame y reproducción del Focus Range.
- [ ] Audio clock y `attachAudio()`.

### Dope Sheet y viewport

- [ ] Zoom, pan, visible range y scrollbar horizontal.
- [ ] Árbol plegable y estado de filas por vista.
- [ ] Indicadores editables de duración y posición.
- [ ] Focus Range completo y cortinas exteriores.
- [ ] Grid totalmente adaptativo.

### Selección e interacción

- [ ] Selección múltiple y elemento principal.
- [ ] Marquee, selección de rango y keyframes agregados editables.
- [ ] Movimiento conjunto, duplicación y nudge por frames.
- [ ] Snapping a keyframes, playhead, markers y límites.
- [ ] Menús contextuales y mapa completo de teclado.

### Edición de valores y curvas

- [ ] Editor inline de tiempo y valor.
- [ ] Curve Editor emergente con handles manuales.
- [ ] Graph Editor redimensionable.
- [ ] Curvas escalares y representación de valores no escalares.
- [ ] Selección sincronizada entre Dope Sheet y Graph Editor.

### Markers, estado visual y persistencia

- [ ] Crear, mover, renombrar y eliminar markers.
- [ ] Definir y versionar `Timeline411EditorState`.
- [ ] Persistir zoom, scroll, Focus Range, markers, paneles y filas plegadas.
- [ ] Importación validada de `animation.json`.

### Eventos y calidad

- [ ] Completar el catálogo de eventos de `timeline_api.md`.
- [ ] Change sets y rollback público de transacciones.
- [ ] Proyección incremental y virtualización.
- [ ] Tests diferenciales contra Theatre.js.
- [ ] Tests E2E en navegador real, accesibilidad y pruebas de carga.

### Renderers

- [ ] Factoría de vistas y varias vistas simultáneas.
- [ ] Controlador de interacción compartido.
- [ ] Render model formal independiente del renderer.
- [ ] Timeline 411 WebGL.

## Fuera de la paridad estricta con el timeline 0.7.2

- Colaboración multiusuario.
- Event tracks propios.
- Plugins de interpoladores externos.
- Exportación offline de frames.
- Waveform de audio.
- Shadow DOM.
