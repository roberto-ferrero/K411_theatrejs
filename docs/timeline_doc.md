# Glosario y conceptos de Timeline 411

Este documento define el vocabulario utilizado para estudiar Theatre.js y diseñar
Timeline 411 con el núcleo de lógica separado de sus representaciones HTML, SVG,
Canvas o WebGL. Su estado de animación canónico utiliza el mismo modelo JSON que
Theatre.js 0.7.2.

La especificación propuesta para interactuar con el timeline y sus eventos se
encuentra en [API y eventos del timeline](./timeline_api.md).

La referencia estudiada es Theatre.js 0.7.2. Algunos términos describen conceptos
propios de Theatre.js y otros son nombres propuestos para nuestra arquitectura.

## Índice

1. [Mapa conceptual](#1-mapa-conceptual)
2. [Estructura del documento](#2-estructura-del-documento)
3. [Props y vinculación con objetos](#3-props-y-vinculación-con-objetos)
4. [Tracks y canales](#4-tracks-y-canales)
5. [Keyframes](#5-keyframes)
6. [Segmentos e interpolación](#6-segmentos-e-interpolación)
7. [Curvas Bezier](#7-curvas-bezier)
8. [Evaluación](#8-evaluación)
9. [Tiempo y reproducción](#9-tiempo-y-reproducción)
10. [Relojes y actualización](#10-relojes-y-actualización)
11. [Edición e historial](#11-edición-e-historial)
12. [Selección](#12-selección)
13. [Snapping](#13-snapping)
14. [Coordenadas, zoom y scroll](#14-coordenadas-zoom-y-scroll)
15. [Componentes visuales](#15-componentes-visuales)
16. [Interacción y detección](#16-interacción-y-detección)
17. [Estado y reactividad](#17-estado-y-reactividad)
18. [Representación desacoplada](#18-representación-desacoplada)
19. [Puertos y adaptadores propuestos](#19-puertos-y-adaptadores-propuestos)
20. [Términos ambiguos](#20-términos-ambiguos)
21. [Vocabulario canónico recomendado](#21-vocabulario-canónico-recomendado)

## 1. Mapa conceptual

La cadena que relaciona los datos de animación con una mesh es:

```text
Project
└─ Sheet / Composition
   ├─ Sequence
   │  ├─ Track
   │  │  └─ Keyframe
   │  └─ Playhead
   └─ Timeline Object
      └─ Property / Prop
         └─ Binding Adapter
            └─ Mesh, material, cámara, DOM, audio, etc.
```

El flujo de un valor durante la reproducción es:

```text
Clock
  │
  ▼
TimelinePlayer ──► tiempo actual
                        │
                        ▼
                 TimelineEvaluator
                        │
                        ▼
                  valores evaluados
                        │
                        ▼
                   BindingAdapter
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
        Three.js mesh       Elemento HTML
```

La separación arquitectónica deseada es:

```text
DATOS                  LÓGICA                 REPRESENTACIÓN

TimelineDocument ───► Store/Evaluator ─────► RenderModel
Tracks                Player                 HTML Renderer
Keyframes             Viewport               WebGL Renderer
Props                 Snapping               SVG Renderer
```

## 2. Estructura del documento

### Timeline Document

Alias público de Timeline 411 para el `ProjectState` compatible con Theatre.js
0.7.2. Contiene `sheetsById`, `definitionVersion` y `revisionHistory`; dentro de
cada sheet almacena duración, subdivisiones temporales, static overrides, tracks y
keyframes.

Es la fuente de verdad de la animación y no contiene referencias a elementos DOM,
objetos Three.js, buffers WebGL ni estado propio de la GUI. El JSON producido debe
poder entregarse directamente a `getProject(id, {state})` de Theatre.js 0.7.2.

### Project

Contenedor raíz de Theatre.js. Agrupa sheets, estado exportado, configuración y
recursos. Aunque Timeline 411 exponga handles con otros nombres, su JSON siempre
conserva la estructura raíz de proyecto de Theatre.js.

### Sheet

Composición de Theatre.js que agrupa objetos animados bajo una misma secuencia.
Puede interpretarse como una escena, clip o composición.

```text
Sheet: Animated scene
├─ Torus Knot
├─ Camera
├─ Directional Light
└─ Environment
```

### Composition

Nombre propuesto como alternativa a `Sheet`. Representa una unidad completa de
animación con duración, tracks y objetos relacionados. Es un nombre de la API de
Timeline 411; al serializar se guarda dentro de `sheetsById` como una sheet.

### Sheet Instance

Instancia de una sheet que reutiliza la misma definición de animación, pero tiene
una posición de reproducción independiente. Permite aplicar una animación común a
varios objetos.

### Sequence

Conjunto de tracks que comparten duración, unidad temporal y playhead. En
Theatre.js, cada sheet expone su secuencia mediante `sheet.sequence`.

### Timeline Object

Representación lógica de una entidad animable. No es la mesh, cámara o elemento
HTML real: sólo declara las props que el timeline puede controlar.

### Object ID

Identificador estable de un objeto dentro del documento. No debe depender de la
posición del objeto en un array ni de su posición visual en el editor.

### Definition Version

Versión del esquema utilizado para serializar el documento. Permite reconocer y
migrar documentos. Para compatibilidad con Theatre.js 0.7.2, Timeline 411 emite
`definitionVersion: "0.4.0"`.

### Serialization

Conversión del estado canónico al `ProjectState` de Theatre.js 0.7.2. Debe estar
separada del store, el evaluador y los renderers y no debe añadir claves propias
de Timeline 411.

### Deserialization

Carga y validación de un `ProjectState` de Theatre.js 0.7.2 sin transformarlo a un
segundo modelo. Debe comprobar versión, IDs duplicados, tipos, tiempos inválidos y
keyframes desordenados.

### Migration

Transformación explícita entre versiones del formato Theatre. No debe ocurrir de
forma silenciosa ni afirmar compatibilidad 0.7.2 hasta superar una prueba de carga
directa con `getProject()`.

### Editor Sidecar

Documento separado que guarda únicamente preferencias de Timeline 411: vistas,
zoom, scroll, paneles y filas plegadas. No se mezcla con el JSON de animación.

```text
animation.json              Estado compatible con Theatre.js 0.7.2
timeline411.editor.json     Estado visual exclusivo de Timeline 411
```

## 3. Props y vinculación con objetos

### Property / Prop

Valor lógico que puede ser controlado por el timeline. Ejemplos:

```text
position.x
rotation.y
material.opacity
light.intensity
visible
```

### Property Path / Prop Path

Ruta que identifica una prop dentro de un objeto compuesto.

```ts
['rotation', 'x']
['material', 'opacity']
['visible']
```

### Encoded Prop Path

Representación serializada de un property path. Theatre.js utiliza strings JSON:

```json
{
  "trackIdByPropPath": {
    "[\"rotation\",\"x\"]": "Q9IUK1iBde"
  }
}
```

La codificación debe encapsularse para que el resto del sistema no dependa de su
formato textual.

### Leaf Prop

Prop final que contiene un valor animable. `rotation.x` es una leaf prop;
`rotation` es un contenedor.

### Compound Prop

Prop que agrupa otras props:

```text
rotation
├─ x
├─ y
└─ z
```

Los compound props son útiles para organizar el editor y realizar operaciones
sobre varios canales.

### Prop Schema

Contrato que declara las props disponibles, sus tipos, valores iniciales, rangos
y reglas de interpolación.

### Prop Type

Tipo semántico de una prop: número, boolean, string, enum, vector, color, etc. El
tipo determina cómo validar, editar e interpolar su valor.

### Default Value

Valor declarado en el esquema. Se utiliza cuando no existe un valor más
específico ni keyframes.

### Initial Value

Valor inicial proporcionado por una instancia concreta. Puede sobrescribir el
valor por defecto sin modificar la definición compartida.

### Static Override

Valor editado que todavía no está animado mediante keyframes. Theatre.js lo
persiste separado de los tracks.

### Sequenced Value

Valor producido por un track en la posición actual. Mientras una prop está
secuenciada, este resultado es el que controla su salida.

La precedencia conceptual es:

```text
Default Value
      │
      ▼
Initial Value
      │
      ▼
Static Override
      │
      ▼
Sequenced Value
```

### Target

Dirección lógica que identifica el destino de un track. Ejemplos:

```text
torus.rotation.x
camera.position.z
keyLight.intensity
material.opacity
```

El target es información del dominio de la aplicación; el evaluador no debería
resolverlo ni conocer el objeto final.

### Binding

Relación entre una prop lógica del timeline y una propiedad real de la
aplicación.

### Binding Adapter

Adaptador encargado de aplicar los valores evaluados al sistema final. Puede
existir un adaptador para Three.js, otro para DOM y otro para audio.

```text
Target lógico                Propiedad real

torus.rotation.x  ────────►  mesh.rotation.x
torus.visible     ────────►  mesh.visible
light.intensity   ────────►  light.intensity
material.color    ────────►  material.color
```

### Value Sink

Consumidor final de un valor evaluado: mesh, material, cámara, componente, nodo
de audio o cualquier sistema externo.

## 4. Tracks y canales

### Track

Evolución temporal de una única prop. Contiene una identidad estable, un target,
un valor por defecto y una lista ordenada de keyframes.

### Track ID

Identificador estable del track. No debe sustituirse por su índice en un array,
ya que el orden visual puede cambiar.

### Track Type

Estrategia utilizada para evaluar un track. El tipo principal de Theatre.js
0.7.2 es `BasicKeyframedTrack`.

### Channel

Componente individual de un valor compuesto. `position.x`, `position.y` y
`position.z` son tres canales.

Un track y un canal pueden coincidir, pero no son necesariamente el mismo
concepto. Un vector podría almacenarse como un único track vectorial o como tres
tracks escalares.

### Numeric Track

Track que produce valores numéricos interpolables: posición, rotación, escala,
intensidad, opacidad, etc.

### Discrete Track

Track cuyos valores no se mezclan continuamente, como boolean, string, enum o
cambio de recurso.

### Vector Track

Track cuyo valor contiene varios componentes numéricos. Debe definirse si se
edita como una unidad o mediante canales independientes.

### Color Track

Track especializado en colores. Debe declarar el espacio de interpolación: RGB,
HSL, OKLab u otro.

### Event Track

Track que dispara eventos al cruzar determinados tiempos. Se diferencia de un
track de valores porque importa el cruce temporal, la dirección y si el playhead
salta sobre un evento.

### Group Track

Agrupación visual de varios tracks. No tiene por qué persistirse como entidad
evaluable.

### Muted Track

Track temporalmente ignorado por el evaluador. Es útil para comparar variantes
sin borrar datos.

### Locked Track

Track visible pero no editable. El bloqueo pertenece al estado de edición y no
necesariamente a la animación exportada.

### Track, Channel y Row

Conviene mantener esta distinción:

```text
Track    = unidad evaluable del modelo
Channel  = componente animable de una propiedad
Row      = representación visual dentro del editor
```

## 5. Keyframes

### Keyframe

Punto temporal que asigna un valor a un track. Es la unidad principal de edición
de una animación basada en claves.

### Keyframe ID

Identidad estable del keyframe. Permite moverlo, reordenarlo y seleccionarlo sin
perder referencias.

### Keyframe Time

Posición temporal del keyframe. Se recomienda almacenar segundos como unidad
canónica y usar frames solamente para formato y snapping.

En Timeline 411 se edita desde el campo `KF` de la toolbar cuando existe un
keyframe seleccionado. Es distinto de `Position`: mover el playhead no cambia el
keyframe ni elimina la selección. Al confirmar, el tiempo se ajusta al frame más
cercano, se valida contra `[0, duración]` y se guarda mediante una transacción
con undo/redo. El playhead se sincroniza después con el nuevo tiempo.

Sin un keyframe seleccionado, el bloque contextual que contiene el campo `KF`
queda oculto. No se utiliza para mostrar el playhead, que mantiene un indicador
independiente dentro del bloque básico.

### Selected Keyframe Context

Bloque contextual enmarcado de la toolbar que sólo aparece cuando existe un
único keyframe seleccionado. Contiene el tiempo editable y el easing del
segmento saliente. El resto de la toolbar conserva por separado los controles
básicos y las acciones globales.

El easing se presenta como preset cuando sus handles coinciden, como
`Curva importada` cuando el JSON contiene una curva sin preset y como
`Sin segmento` para el último keyframe, donde el selector queda deshabilitado.
Los segmentos nuevos son `Linear` por defecto. Una curva importada permanece
intacta hasta que el usuario escoge explícitamente un preset que la sustituye.

### Keyframe Value

Valor que el track alcanza en el tiempo del keyframe. Debe ser compatible con el
tipo del track.

### Previous Keyframe

Keyframe situado inmediatamente antes del tiempo evaluado. Forma el extremo
izquierdo del segmento activo.

### Next Keyframe

Keyframe situado inmediatamente después del tiempo evaluado. Forma el extremo
derecho del segmento activo.

### Active Segment

Segmento que contiene la posición temporal actual. Puede cachearse durante el
playback para evitar búsquedas repetidas.

### Keyframe Collision

Situación en la que dos keyframes del mismo track ocupan el mismo tiempo. La
implementación debe decidir si reemplazarlos, fusionarlos o rechazar la operación.
Timeline 411 rechaza la edición si otro keyframe del mismo track ocupa el frame
de destino; no reemplaza ni elimina el keyframe existente.

### Keyframe Toggle

Control de rombo asociado a una propiedad primitiva. En Timeline 411, `◇`
indica que no hay keyframe en el playhead y `◆` que sí existe. Activarlo crea o
elimina el keyframe mediante el editor, independientemente de que la
representación sea HTML o WebGL.

La primera activación sobre una propiedad estática crea su track. Al desactivar
el único keyframe, el track se elimina y el valor evaluado se conserva como
static override.

### Empty Track

Track que existe en `trackIdByPropPath` y `trackData`, pero cuya lista de
keyframes está vacía. No produce un valor durante la evaluación. Timeline 411
permite poblarlo desde el rombo o mediante `addKeyframeAt()`; el valor inicial se
obtiene del valor evaluado de la propiedad. El flujo normal de borrado evita
generarlo porque des-secuencia automáticamente el track al quitar su última
clave.

### Aggregate Keyframe

Símbolo visual que representa varios keyframes coincidentes en el tiempo. Por
ejemplo, la fila `rotation` puede mostrar un rombo agregado para los keyframes de
`x`, `y` y `z`.

```text
rotation     ◆──────────────◆
rotation.x   ●──────────────●
rotation.y   ●──────────────●
rotation.z   ●──────────────●
```

El aggregate keyframe pertenece al view model. No tiene por qué existir en el
documento persistente.

### Keyframe Group

Conjunto de keyframes seleccionado y editado como una unidad. Puede abarcar
varios tracks.

### Connected Right

Propiedad de Theatre.js que indica si un keyframe está conectado con el siguiente.
Si es `false`, Theatre mantiene el valor izquierdo en lugar de interpolarlo.

En un modelo propio puede expresarse de forma más directa mediante el tipo de
interpolación del segmento saliente.

## 6. Segmentos e interpolación

### Segment

Intervalo comprendido entre dos keyframes consecutivos. La curva de interpolación
pertenece conceptualmente al segmento.

```text
Keyframe A                          Keyframe B
(timeA, valueA)                     (timeB, valueB)
       ●──────────────────────────────────●
```

### Interpolation

Cálculo del valor intermedio entre dos valores. Depende del tipo semántico de la
prop.

### Easing

Transformación del progreso temporal para producir aceleración, desaceleración u
otro comportamiento. No calcula por sí mismo el valor final.

### Linear Progress

Progreso temporal normalizado antes de aplicar easing:

```ts
const linearProgress = (time - leftTime) / (rightTime - leftTime)
```

### Value Progress

Progreso obtenido después de aplicar el easing. Se entrega al interpolador del
tipo.

### Interpolator

Función que mezcla dos valores utilizando un progreso.

```ts
const value = left + (right - left) * progress
```

### Easing frente a Interpolator

```text
Easing:
tiempo normalizado ──► progreso transformado

Interpolator:
valor A + valor B + progreso ──► valor resultante
```

Una curva Bezier es un easing. Una función `lerp()` es un interpolador.

### Linear Interpolation

Interpolación con progreso y velocidad constantes. Su easing es la función
identidad.

### Hold / Step

Mantiene el valor izquierdo hasta alcanzar el siguiente keyframe. Es apropiada
para boolean, enum, strings y cambios instantáneos.

### Extrapolation

Comportamiento fuera del intervalo cubierto por keyframes. Theatre.js mantiene el
valor del primer keyframe antes del inicio y el del último después del final.

### Clamping

Restricción de un valor o progreso a un rango. No debe aplicarse automáticamente
al progreso de valor si queremos permitir overshoot.

## 7. Curvas Bezier

### Cubic Bezier

Curva cúbica definida por dos extremos y dos puntos de control:

```text
P0 = inicio
P1 = control de salida
P2 = control de entrada
P3 = final
```

El formato habitual es:

```ts
cubicBezier(x1, y1, x2, y2)
```

- El eje X representa el progreso temporal.
- El eje Y representa el progreso del valor.
- La curva transforma progreso lineal en progreso interpolado.

### Bezier Handle

Punto de control editable que modifica la forma de la curva.

### Incoming Handle

Handle que controla la entrada al keyframe y afecta al segmento situado a su
izquierda.

### Outgoing Handle

Handle que controla la salida del keyframe y afecta al segmento situado a su
derecha.

Theatre.js almacena los handles de cada keyframe así:

```ts
handles: [
  incomingX,
  incomingY,
  outgoingX,
  outgoingY,
]
```

Para formar el segmento entre los keyframes A y B utiliza:

```ts
[
  A.handles[2],
  A.handles[3],
  B.handles[0],
  B.handles[1],
]
```

### Broken Handles

Handles de entrada y salida que pueden modificarse independientemente. Permiten
cambios bruscos de pendiente.

### Linked Handles

Handles que conservan dirección, longitud o simetría conjunta. Facilitan la
creación de curvas suaves.

### Tangent

Dirección local de la curva al entrar o salir de un keyframe. Los handles son una
forma visual de controlar la tangente.

### Overshoot

Curva cuyo progreso supera temporalmente el valor final. Requiere permitir que Y
salga del intervalo `[0, 1]`.

### Undershoot

Curva cuyo progreso baja temporalmente por debajo del valor inicial.

### Bezier Solver

Algoritmo que encuentra el parámetro interno de la curva correspondiente a un
valor X. No basta con evaluar directamente la coordenada Y.

```text
progreso temporal
       │
       ▼
resolver Bezier X
       │
       ▼
parámetro interno t
       │
       ▼
evaluar Bezier Y
       │
       ▼
progreso del valor
```

Puede implementarse mediante Newton-Raphson, búsqueda binaria o una combinación
de ambos.

### Curve Sampling

Evaluación de la curva en múltiples puntos. Se utiliza para visualizarla o
generar geometría.

### Curve Tessellation

Conversión de la curva a segmentos de línea. Es especialmente relevante para un
renderer WebGL.

### Curve Editor

Interfaz donde se modifican gráficamente los handles de un segmento.

## 8. Evaluación

### Evaluation

Cálculo de los valores del timeline en un tiempo concreto. Debe ser una operación
pura siempre que sea posible.

### Track Evaluation

Evaluación individual de un track:

1. Localizar los keyframes que rodean al tiempo.
2. Calcular el progreso lineal.
3. Aplicar el easing.
4. Interpolar los valores.
5. Devolver el resultado.

### Sampling

Evaluación del timeline en posiciones temporales concretas. Se usa durante el
playback, generación de previews, exportación y tests.

### Sample Time

Tiempo solicitado al evaluador. Debe expresarse en la unidad canónica del
documento, normalmente segundos.

### Evaluated Value

Resultado producido por un track en un tiempo concreto. Posteriormente se aplica
mediante el binding adapter.

### Timeline Snapshot

Snapshot lógico que contiene el tiempo y todos los valores evaluados. Este nombre
es preferible a `TimelineFrame` para evitar confundirlo con un frame renderizado o
una subdivisión del FPS.

### Binary Search

Búsqueda eficiente del segmento activo dentro de una lista de keyframes ordenada.
Evita recorrer todos los keyframes en cada evaluación.

### Evaluation Cache

Memoria del segmento activo o de resultados anteriores. Puede mejorar el
playback, pero debería añadirse después de medir el rendimiento.

### Dirty Track

Track cuyo resultado debe recalcularse porque cambiaron sus keyframes, el tipo de
prop o una dependencia.

### Interpolación según el tipo

#### Number

```ts
left + (right - left) * progress
```

#### Vector

```ts
[
  lerp(left[0], right[0], progress),
  lerp(left[1], right[1], progress),
  lerp(left[2], right[2], progress),
]
```

#### Color

Debe especificar el espacio de color utilizado por el interpolador.

#### Boolean, string o enum

Normalmente utilizan interpolación discreta:

```ts
progress < 1 ? left : right
```

## 9. Tiempo y reproducción

### Playhead

Indicador de la posición temporal actual. Es estado de runtime y no forma parte
de los datos persistentes de animación.

### Position

Tiempo actual de la secuencia. Se recomienda almacenarlo en segundos.

### Duration

Longitud total de la secuencia.

En Timeline 411 se puede modificar desde la toolbar o mediante
`transaction.setDuration(sheetId, duration)`. Es un cambio del documento
canónico y participa en undo/redo. Reducirla acorta el rango reproducible pero no
elimina keyframes situados después del nuevo final.

### Playback Range

Intervalo que será reproducido. Puede ser menor que la duración completa.

### Focus Range

Intervalo visible o destacado para edición. No tiene que coincidir con el rango
de reproducción.

### FPS

Frames por segundo utilizados para formato, rejilla y snapping. El runtime puede
actualizarse con otra frecuencia.

### Sub-units per Unit

Nombre empleado por Theatre.js para las subdivisiones de la unidad temporal. En
una secuencia basada en segundos suele equivaler al FPS.

### Frame Number

Índice discreto correspondiente a un tiempo:

```ts
const frameNumber = Math.round(time * fps)
```

### Frame Duration

Duración temporal de un frame:

```ts
const frameDuration = 1 / fps
```

### Playback Rate

Multiplicador de velocidad de reproducción: `0.5`, `1`, `2`, etc.

### Playback Direction

Sentido de reproducción. Theatre.js contempla `normal`, `reverse`, `alternate` y
`alternateReverse`.

### Iteration Count

Número de repeticiones del rango de reproducción. Puede ser finito o infinito.

### Loop

Repetición del rango cuando el playhead alcanza su extremo.

### Ping-pong

Reproducción que alterna dirección en cada iteración. En Theatre.js corresponde a
las direcciones `alternate` y `alternateReverse`.

### Pause

Detiene el avance conservando la posición actual.

### Stop

Detiene la reproducción y, según la API elegida, puede restablecer la posición.
Su semántica debe definirse explícitamente.

### Seek

Cambio directo de la posición del playhead.

### Playhead Scrubbing

Arrastre manual del playhead. No debe confundirse con la API de transacciones
temporales `studio.scrub()` de Theatre.js.

## 10. Relojes y actualización

### Clock

Fuente abstracta de tiempo. Permite desacoplar el reproductor de
`requestAnimationFrame`.

### Ticker

Sistema que notifica actualizaciones temporales. Theatre.js utiliza un ticker
configurable para controlar cuándo avanza la secuencia.

### RAF Driver

Adaptador de reloj basado en `requestAnimationFrame`. Es adecuado para una
aplicación interactiva HTML o WebGL.

### Playback Controller

Componente que controla posición, dirección, rango, velocidad, iteraciones y
estado de reproducción. No debería evaluar tracks ni dibujar la interfaz.

### Delta Time

Tiempo transcurrido desde la actualización anterior. Sirve para calcular cuánto
debe avanzar el playhead.

### Wall-clock Time

Tiempo real proporcionado por el reloj. Es diferente de la posición del timeline.

### Deterministic Clock

Reloj que se avanza manualmente. Permite realizar tests repetibles y exportar la
animación frame a frame.

### Audio Clock

Tiempo proporcionado por el sistema de audio. Puede convertirse en la autoridad
para mantener sincronizados sonido y animación.

### Clock Drift

Diferencia acumulada entre dos fuentes de tiempo. Debe corregirse cuando audio y
animación utilizan relojes diferentes.

## 11. Edición e historial

### Command

Descripción explícita de una modificación del documento.

```ts
{type: 'addKeyframe', trackId, keyframe}
{type: 'updateKeyframe', trackId, keyframeId, patch}
{type: 'removeKeyframes', trackId, keyframeIds}
{type: 'setDuration', duration}
```

### Reducer

Función que recibe un documento y un comando y produce un nuevo documento. No
debe depender de DOM, React ni WebGL.

### Transaction

Conjunto de operaciones tratado como una acción atómica. Produce un único paso
de undo.

### Temporary Transaction

Transacción provisional que se actualiza durante un gesto y posteriormente se
confirma o cancela.

### Gesture / Editing Gesture

Interacción continua entre `pointerdown` y `pointerup`, como arrastrar un
keyframe, cambiar un handle o escalar una selección.

```text
pointerdown ──► beginGesture()
pointermove ──► apply()/preview()
pointermove ──► apply()/preview()
pointerup   ──► commit()
Escape      ──► cancel()
```

### Scrub Transaction

Nombre relacionado con `studio.scrub()` de Theatre.js. Consolida múltiples
cambios temporales en una sola entrada de historial. Para evitar ambigüedad,
proponemos denominarlo `EditingGesture`.

### Commit

Confirma una transacción temporal y añade su resultado al historial.

### Cancel / Discard

Cancela la transacción y recupera el estado anterior al gesto.

### Undo

Restaura el documento histórico anterior.

### Redo

Reaplica una modificación deshecha. Debe invalidarse cuando se ejecuta una nueva
operación después de un undo.

### History Entry

Unidad almacenada para undo/redo. Puede ser un snapshot completo, un patch o un
comando reversible.

### Optimistic Preview

Estado provisional mostrado mientras una operación todavía no ha sido
confirmada.

## 12. Selección

### Selection

Conjunto de entidades seleccionadas: objetos, tracks, keyframes o marcadores.

### Background Deselection

Liberación de la selección al hacer clic en una zona no interactiva del
timeline. Timeline 411 la aplica con un clic izquierdo sencillo sobre una lane o
el fondo temporal, sin cambiar el playhead. La deselección limpia el resaltado y
los controles asociados y emite `selection:change`.

El ruler, el playhead, los keyframes y los gestos de pan o drag no cuentan como
fondo. La actualización se realiza sin reconstruir la superficie para conservar
el doble clic de creación de keyframes.

### Primary Selection

Elemento principal dentro de una selección múltiple. Puede actuar como referencia
para alineación o edición relativa.

### Multi-selection

Selección de varias entidades mediante modificadores de teclado, selección de
rango o caja de selección.

### Selection Box / Marquee

Rectángulo utilizado para seleccionar elementos. Pertenece al estado efímero de
la interfaz.

### Selection Anchor

Punto de referencia empleado para extender una selección.

### Selection Bounds

Límites temporales y verticales del conjunto seleccionado. Permiten moverlo o
escalarlo.

### Aggregate Selection

Selección de un símbolo que representa varios keyframes. Antes de editar debe
resolverse a los IDs de los keyframes reales.

### Range Selection

Selección de entidades incluidas dentro de un intervalo temporal y, opcionalmente,
un conjunto de tracks.

## 13. Snapping

### Snapping

Ajuste automático de una posición a un objetivo cercano.

### Snap Target

Posición candidata a recibir el snapping: frame, keyframe, marcador, playhead,
inicio o final de un rango.

### Snap Source

Punto de la selección que se está ajustando. Puede ser un keyframe o un borde de
una selección múltiple.

### Snap Threshold

Distancia máxima para activar el snapping. Es recomendable medirla en píxeles
para obtener un comportamiento consistente con cualquier nivel de zoom.

### Frame Snapping

Ajuste a subdivisiones temporales determinadas por el FPS:

```ts
const snappedTime = Math.round(time * fps) / fps
```

### Keyframe Snapping

Ajuste a la posición de otros keyframes. Los elementos que se están moviendo
deben excluirse de los posibles targets.

### Edge Snapping

Ajuste al inicio o final de una secuencia, focus range o selección.

### Snap Guide

Indicador visual del objetivo de snapping activo. Es un estado derivado de la
interacción.

## 14. Coordenadas, zoom y scroll

### Unit Space

Espacio de coordenadas del documento. En un timeline temporal, una unidad suele
equivaler a un segundo.

### Scaled Space

Espacio intermedio que aplica el nivel de zoom, pero no el desplazamiento visible.

### Clipped Space

Coordenadas visibles después de aplicar zoom y desplazamiento. Generalmente se
expresan en píxeles relativos al panel.

### Screen Space

Coordenadas absolutas de pantalla. Se utilizan para eventos de puntero, menús y
popovers.

### Viewport

Descripción del rango temporal visible y de las dimensiones del área de dibujo.
En Timeline 411 es una unidad lógica independiente del renderer. Mantiene
`visibleStart`, `visibleEnd`, duración, FPS, anchura, zoom y modo `fit` o
`manual`.

### Visible Range

Intervalo temporal mostrado por el viewport, por ejemplo `[2, 8]` segundos.
Se limita al intervalo `[0, duración]` y nunca modifica los tiempos almacenados.

### Zoom

Cambio de la cantidad de tiempo visible por píxel. Puede representarse
indirectamente modificando el visible range.

Timeline 411 utiliza zoom focal: el instante situado bajo el cursor conserva la
misma coordenada visual antes y después de aplicar el zoom. El rango mínimo es el
mayor entre dos frames y `0.05 s`.

### Pan / Horizontal Scroll

Desplazamiento horizontal del visible range. No modifica los tiempos de los
keyframes.

El pan puede proceder de trackpad horizontal, `Shift + rueda`, `Espacio + drag`,
botón central, scrollbar o API. Todos esos orígenes producen el mismo cambio en
el modelo de viewport.

### Pixels per Second

Escala horizontal derivada del viewport.

### Left Padding

Área reservada antes del comienzo de la zona temporal. Debe incluirse en las
transformaciones de coordenadas.

### Coordinate Transform

Conversión entre tiempo y píxeles:

```ts
const x =
  leftPadding +
  ((time - visibleStart) / (visibleEnd - visibleStart)) * drawableWidth
```

Su transformación inversa es:

```ts
const time =
  visibleStart +
  ((x - leftPadding) / drawableWidth) * (visibleEnd - visibleStart)
```

Estas funciones deben ser puras y compartidas por todos los renderers.

## 15. Componentes visuales

### Dope Sheet

Vista de filas y keyframes distribuidos en el tiempo. Está orientada a editar la
temporización y organización de los keyframes.

### Graph Editor

Vista donde X representa tiempo e Y representa valor. Permite modificar valores,
pendientes y tangentes.

### Curve Editor

Editor especializado en la curva de easing de un segmento. Puede integrarse en
el graph editor o mostrarse en un popover.

### Ruler

Regla temporal situada normalmente en la parte superior del timeline. Muestra
segundos, frames y divisiones principales.

### Grid

Conjunto de líneas temporales de referencia. Su densidad debe adaptarse al zoom.

### Grid Tick

Marca individual de la regla o rejilla. El view model puede representarla así:

```ts
interface GridTick {
  time: number
  x: number
  major: boolean
}
```

### Major Tick

Marca temporal principal: segundos, decenas de segundos o minutos.

### Minor Tick

Subdivisión secundaria: frames o fracciones de segundo.

### Row

Fila visual que representa un objeto, grupo, prop o track. Pertenece al view
model, no necesariamente al documento.

### Lane

Área temporal horizontal asociada a una fila. Contiene keyframes y segmentos.

### Tree Row

Fila jerárquica y expandible:

```text
Object
└─ Compound Prop
   └─ Leaf Prop / Track
```

### Property Value Cell

Celda situada a la derecha de una `Tree Row` primitiva. Muestra el valor evaluado
de la propiedad en la posición del playhead. Es una proyección del modelo y no un
segundo estado de datos.

Su modo depende de la procedencia del valor:

- `readonly`: el playhead está dentro de un segmento interpolado; sólo muestra el
  resultado del evaluador.
- `keyframe`: el playhead coincide con un keyframe; editar la celda modifica
  `keyframe.value` mediante una transacción.
- `static`: la propiedad no tiene track; editar la celda modifica su static
  override.

El modo debe calcularse fuera del renderer para que una futura vista WebGL pueda
aplicar exactamente las mismas reglas de edición que la vista HTML.

### Row Height

Altura de una fila. Es necesaria para layout, virtualización y hit testing.

### Playhead Line

Línea vertical que atraviesa el timeline y representa la posición actual.
En Timeline 411 es puramente visual y utiliza `pointer-events: none`; el playhead
sólo se manipula desde el ruler o desde su handle superior.

### Keyframe Glyph

Símbolo visual de un keyframe, normalmente un rombo o círculo.

### Connector

Línea visual entre keyframes en el dope sheet. No tiene que representar la forma
real de la curva de valores.

### Focus Curtain

Área visual que oscurece la zona exterior al focus range.

### Marker

Punto temporal con identidad y, opcionalmente, nombre. Puede utilizarse para
navegación, eventos o snapping.

### Adaptive Grid

Rejilla cuya separación cambia según el zoom:

```text
Zoom lejano:  0s      5s      10s
Zoom medio:   0s  1s  2s  3s
Zoom cercano: 0f  1f  2f  3f
```

## 16. Interacción y detección

### Hit Testing

Proceso de determinar qué elemento se encuentra bajo una coordenada.

Cuando varias entidades coinciden, debe existir una prioridad explícita. En
Timeline 411, un keyframe interactivo se resuelve antes que la línea del
playhead: permite seleccionarlo y arrastrarlo aunque ambos compartan la misma
coordenada temporal. La línea del playhead no participa en hit testing; sólo su
handle superior y el ruler aceptan interacción manual.

### Picking

Término habitual para hit testing en Canvas o WebGL. Puede implementarse con un
buffer de IDs, cálculo geométrico o una estructura espacial.

### Hit Zone

Área interactiva de un elemento. Puede ser mayor que su representación visible
para facilitar la selección de keyframes pequeños.

### Hover State

Elemento situado bajo el puntero sin estar necesariamente seleccionado. Es estado
efímero.

### Drag Threshold

Movimiento mínimo necesario para diferenciar un click de un drag.

### Pointer Capture

Mecanismo que permite continuar recibiendo eventos de puntero aunque éste salga
del elemento durante un drag.

### Interaction Controller

Componente que traduce eventos de teclado y puntero en selecciones, gestos y
comandos del store. No debe encargarse de dibujar.

### Keyboard Command

Acción iniciada mediante teclado: borrar, copiar, pegar, undo, redo, mover un
frame, etc.

### Context Action

Operación ofrecida mediante menú contextual: añadir keyframe, cambiar easing,
silenciar track o eliminar selección.

## 17. Estado y reactividad

### Canonical State

Fuente de verdad a partir de la cual se deriva el resto. En nuestra arquitectura
será `TimelineDocument`.

### Derived State

Información calculada desde el estado canónico: filas visibles, coordenadas X,
ticks, keyframes agregados y geometría de selección.

### Historic State

Estado que participa en undo/redo: tracks, keyframes, valores, curvas y duración.

### Ahistoric State

Estado persistente que no debería crear entradas de undo: zoom, scroll, paneles
abiertos o filas plegadas. Theatre.js utiliza esta distinción internamente.

### Ephemeral State

Estado transitorio que no debe persistirse: hover, gesto activo, snap actual, caja
de selección o menú contextual abierto.

### Runtime State

Estado de reproducción: posición, playing, dirección, rate y rango activo.

### Store

Contenedor que administra el estado, aplica comandos y notifica cambios. No debe
conocer DOM ni WebGL.

### Subscription

Registro para recibir cambios del store o del player. Debe proporcionar una forma
de desuscribirse.

### Atom

Contenedor reactivo de un valor mutable. Theatre.js utiliza los átomos de
Dataverse.

### Pointer

Referencia reactiva a una parte concreta del estado en Dataverse.

### Prism

Valor derivado reactivo y memoizado de Dataverse. En una implementación más
pequeña puede sustituirse por selectores y suscripciones.

### Selector

Función que extrae o deriva una parte del estado. Es una alternativa genérica a
los conceptos Pointer y Prism.

### Memoization

Reutilización de resultados mientras sus entradas no cambien. Resulta útil para
layout, creación del árbol de filas y evaluación.

## 18. Representación desacoplada

### Aplicación anfitriona / Host Application

Web o aplicación que integra el timeline y controla su layout exterior, escena,
datos y ciclo de vida. La aplicación anfitriona proporciona el contenedor de
montaje; el timeline sólo controla su propio elemento raíz dentro de él.

### Mount Target

Elemento `HTMLElement` dedicado donde se monta una vista. Puede indicarse
directamente o mediante un selector CSS que se resuelve una sola vez.

### TimelineView

Instancia visual de un timeline asociada a un contenedor y renderer concretos. Un
mismo `Timeline` puede alimentar varias `TimelineView` HTML o WebGL.

### Container Sizing

Política por la que la aplicación anfitriona determina la anchura y altura del
contenedor, y la vista ocupa el 100 % del espacio disponible. Es la política
acordada para la primera versión.

### Content Sizing

Política alternativa en la que el timeline crece según su contenido. No se
utilizará inicialmente porque puede mezclar el scroll de la página con el del
editor y producir alturas excesivas.

### ResizeObserver

API del navegador utilizada para observar el tamaño real del contenedor. Permite
detectar cambios causados por CSS Grid, Flexbox, divisores, fullscreen o paneles
laterales, no sólo por el resize de la ventana.

### Minimum Interactive Size

Tamaño mínimo que conserva la usabilidad de la superficie. Los defaults acordados
son `640 × 240 px` y `640 × 420 px` con graph editor abierto. Por debajo aparece
scroll en vez de seguir comprimiendo los controles.

### Editor Session

Estado de edición perteneciente a una vista: selección, hover, snapping, viewport
y gesto visual. Documento, playback e historial siguen compartidos por todas las
vistas del mismo timeline.

### Shadow DOM

Mecanismo del navegador que aísla el árbol DOM y los estilos internos de un
componente. Facilita evitar colisiones CSS, pero complica theming, portales,
eventos y algunas integraciones. La primera versión no lo utilizará y protegerá
sus estilos mediante el prefijo `.k411-timeline-*` y CSS custom properties.

### Render Model / View Model

Datos derivados y preparados para ser dibujados: filas, posiciones, geometría,
colores, selección, rejilla y playhead.

```ts
interface TimelineRenderModel {
  rows: readonly RowView[]
  keyframes: readonly KeyframeView[]
  gridTicks: readonly GridTick[]
  playheadX: number
  selectionRect?: Rect
}
```

### Renderer

Componente que convierte el render model en una representación visual. No debería
modificar directamente el documento.

### HTML Renderer

Renderer basado en DOM. Facilita textos, accesibilidad, layout e interacción. Es
una buena opción para validar primero el comportamiento del timeline.

### SVG Renderer

Renderer vectorial apropiado para curvas, conectores e iconos. Puede combinarse
con HTML.

### Canvas Renderer

Renderer inmediato basado en Canvas 2D. Reduce la cantidad de nodos DOM, pero
requiere hit testing propio.

### WebGL Renderer

Renderer basado en buffers, shaders y draw calls. Es adecuado para visualizar
grandes cantidades de keyframes y tracks.

### Renderer Adapter

Implementación concreta de la interfaz de representación. Debe consumir el mismo
render model independientemente de la tecnología.

### Render Primitive

Elemento básico dibujable: línea, rectángulo, texto, rombo, círculo o curva.

### Virtualization

Renderizado exclusivo de las filas y elementos visibles. Es importante cuando el
documento contiene muchos tracks.

### Instanced Rendering

Dibujo de muchas instancias similares mediante una única llamada WebGL. Resulta
adecuado para keyframes y marcas de rejilla.

### Text Atlas

Textura que contiene glifos para dibujar texto en WebGL. Puede utilizarse en la
regla temporal y las etiquetas de las filas.

### Responsabilidad de cada renderer

```text
HTML Renderer                  WebGL Renderer

DOM y estilos                  Buffers y shaders
Accesibilidad                  Instanced rendering
Pointer Events                 Picking
Texto nativo                   Text atlas
         │                            │
         └──── mismo RenderModel ─────┘
```

La interacción común debe seguir este flujo:

```text
pointerX
   │
   ▼
xToTime()
   │
   ▼
snap()
   │
   ▼
TimelineCommand
```

## 19. Puertos y adaptadores propuestos

### TimelineDocument

Datos persistentes y serializables de la animación.

### TimelineStore

Aplica comandos, valida invariantes, administra transacciones y mantiene
undo/redo.

### TimelineEvaluator

Convierte tracks y tiempo en valores evaluados.

### InterpolatorRegistry

Registro de interpoladores seleccionados según el tipo de prop. Permite añadir
vectores, colores o tipos propios sin modificar el evaluador central.

### TimelinePlayer

Controla playhead y reproducción sin conocer la representación.

### AnimationClock

Puerto que proporciona tiempo al player. Puede implementarse mediante RAF, audio
o un reloj determinista.

### TimelineViewport

Mantiene el rango visible y convierte entre tiempo y coordenadas visuales.

### TimelineProjection

Convierte el documento, estado de editor y viewport en un render model.

### TimelineRenderModel

Representación derivada e independiente de HTML o WebGL.

### InteractionController

Traduce entradas de usuario en gestos y comandos.

### BindingAdapter

Aplica los valores evaluados a Three.js, DOM, audio u otro sistema externo.

### TimelineRenderer

Interfaz implementada por los renderers HTML, SVG, Canvas o WebGL.

### TimelineSerializer

Guarda y carga directamente el `ProjectState` compatible con Theatre.js 0.7.2.
No realiza una traducción a otro esquema ni añade estado visual.

### TheatreProjectState

Nombre explícito del modelo JSON canónico. `TimelineDocument` es un alias público
de este tipo para la API de Timeline 411.

### Timeline411EditorSerializer

Guarda y carga el sidecar del editor. Sus datos nunca forman parte del
`TheatreProjectState` entregado a Theatre.js.

## 20. Términos ambiguos

### Frame

Puede significar:

1. Una subdivisión temporal definida por el FPS.
2. Una imagen renderizada por Three.js.
3. Un snapshot lógico de valores evaluados.

Nombres recomendados:

```text
FrameNumber
RenderFrame
TimelineSnapshot
```

### Scrub

Puede significar:

1. Arrastrar el playhead.
2. Modificar un valor continuamente.
3. La transacción temporal `studio.scrub()` de Theatre.js.

Nombres recomendados:

```text
PlayheadScrubbing
ValueScrubbing
EditingGesture
```

### Track y Row

- `Track`: entidad evaluable del documento.
- `Row`: representación visual dentro del editor.

### Curve

Puede significar:

- El easing de un segmento.
- La curva de valores del graph editor.
- La geometría utilizada para dibujarla.

Nombres recomendados:

```text
SegmentEasing
ValueCurve
CurveGeometry
```

### Position

Puede significar:

- Tiempo del playhead.
- Posición espacial de una mesh.
- Coordenada visual de un elemento.

Nombres recomendados:

```text
playheadTime
objectPosition
screenPosition
```

### Value

Puede referirse al valor por defecto, override estático, valor de un keyframe o
resultado evaluado. Se deben usar nombres específicos:

```text
defaultValue
staticValue
keyframeValue
evaluatedValue
```

## 21. Vocabulario canónico recomendado

Se recomienda utilizar estos nombres como contrato principal del sistema:

```text
TimelineDocument
Composition
TimelineObject
PropertyPath
Track
Keyframe
SegmentInterpolation
TimelineEvaluator
TimelineSnapshot
TimelineStore
TimelineCommand
EditingGesture
PlaybackState
TimelinePlayer
AnimationClock
TimelineViewport
TimelineProjection
TimelineRenderModel
InteractionController
BindingAdapter
TimelineRenderer
TimelineSerializer
TheatreProjectState
Timeline411EditorState
TimelineView
TimelineEditorSession
```

También conviene conservar estos términos habituales en las herramientas de
animación:

```text
Dope Sheet
Graph Editor
Playhead
Ruler
Keyframe
Bezier Handle
Snapping
Track
Channel
Marker
Focus Range
```

La clasificación final del vocabulario queda así:

| Datos | Lógica | Interacción | Representación |
|---|---|---|---|
| TimelineDocument | TimelineEvaluator | TimelineCommand | TimelineRenderModel |
| TimelineObject | TimelinePlayer | EditingGesture | HTML Renderer |
| PropertyPath | AnimationClock | Selection | SVG Renderer |
| Track | InterpolatorRegistry | Snapping | Canvas Renderer |
| Keyframe | TimelineViewport | Hit Testing | WebGL Renderer |
| SegmentInterpolation | TimelineProjection | InteractionController | Render Primitive |

Esta terminología debe utilizarse posteriormente para nombrar módulos,
interfaces, eventos, comandos, tests y documentación. Mantener las fronteras del
glosario evita que los datos de animación terminen acoplados a una GUI o a una
tecnología de render concreta.
