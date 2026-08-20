import './timeline411.css'
import {evaluateTrack} from './evaluator'
import {TypedEventEmitter} from './events'
import type {
  EasingPreset,
  KeyframeAddress,
  SerializableValue,
  TheatreBasicKeyframedTrack,
  TimelineDocument,
  TrackAddress,
} from './model'
import type {TimelinePropertyRef} from './objectApi'
import {isSerializableMap} from './paths'
import type {TimelinePropTypeConfig} from './propTypes'
import {
  buildTimelineRows,
  collectRowKeyframes,
  createGridTicks,
  projectTimelineRowValue,
  snapToFrame,
  timeToX,
  xToTime,
} from './projection'
import type {TimelineRow, TimelineRowValueProjection} from './projection'
import type {EditingGesture} from './store'
import {Timeline411} from './timeline'

const rowHeight = 28
const rulerHeight = 30
const pixelsPerSecond = 150
const minimumWidth = 640
const minimumHeight = 240

export interface Timeline411ViewEvents {
  'selection:change': {selection?: KeyframeAddress}
  'view:resize': {width: number; height: number}
  'viewport:change': {scrollLeft: number; scrollTop: number}
  'panel:resize': {width: number}
}

export class Timeline411HtmlView {
  private readonly events = new TypedEventEmitter<Timeline411ViewEvents>()
  private root?: HTMLElement
  private treeRows?: HTMLElement
  private timelineScroll?: HTMLElement
  private surface?: HTMLElement
  private playButton?: HTMLButtonElement
  private undoButton?: HTMLButtonElement
  private redoButton?: HTMLButtonElement
  private timeInput?: HTMLInputElement
  private interpolationSelect?: HTMLSelectElement
  private resizeObserver?: ResizeObserver
  private selected?: KeyframeAddress
  private activeGesture?: EditingGesture
  private cancelPointerInteraction?: () => void
  private treeWidth = 240
  private surfaceWidth = 1
  private currentRows: readonly TimelineRow[] = []
  private readonly treeRowElements = new Map<string, HTMLElement>()
  private readonly unsubscribers: Array<() => void> = []

  constructor(
    private readonly timeline: Timeline411,
    private readonly sheetId: string,
  ) {}

  mount(target: string | HTMLElement): void {
    if (this.root) throw new Error('La vista Timeline 411 ya está montada')
    const container = resolveMountTarget(target)
    if (container.querySelector('[data-timeline411-view]')) {
      throw new Error('El contenedor ya tiene una vista Timeline 411')
    }
    this.root = this.createRoot()
    container.appendChild(this.root)

    this.resizeObserver = new ResizeObserver(() => {
      this.render()
      this.events.emit('view:resize', {
        width: container.clientWidth,
        height: container.clientHeight,
      })
    })
    this.resizeObserver.observe(container)

    this.unsubscribers.push(
      this.timeline.store.subscribe(() => this.render(), false),
      this.timeline
        .getPlayer(this.sheetId)
        .subscribe(() => this.updatePlayback(), false),
      this.timeline.on('history:change', () => this.updateHistory()),
    )
    this.root.addEventListener('keydown', this.onKeyDown)
    this.render()
    this.updatePlayback()
    this.updateHistory()
  }

  unmount(): void {
    this.cancelActiveGesture()
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    this.root?.removeEventListener('keydown', this.onKeyDown)
    this.root?.remove()
    this.root = undefined
  }

  dispose(): void {
    this.unmount()
    this.events.clear()
  }

  on<Key extends keyof Timeline411ViewEvents>(
    type: Key,
    listener: (payload: Timeline411ViewEvents[Key]) => void,
  ): () => void {
    return this.events.on(type, listener)
  }

  private createRoot(): HTMLElement {
    const root = document.createElement('section')
    root.className = 'k411-timeline-root'
    root.dataset.timeline411View = ''
    root.tabIndex = 0
    root.setAttribute('aria-label', 'Timeline 411')

    const shell = document.createElement('div')
    shell.className = 'k411-timeline-shell'
    shell.style.minWidth = `${minimumWidth}px`
    shell.style.minHeight = `${minimumHeight}px`
    const toolbar = this.createToolbar()
    const body = document.createElement('div')
    body.className = 'k411-timeline-body'

    const tree = document.createElement('aside')
    tree.className = 'k411-timeline-tree'
    tree.style.width = `${this.treeWidth}px`
    const treeHeader = document.createElement('div')
    treeHeader.className = 'k411-timeline-tree__header'
    treeHeader.textContent = 'Objetos y propiedades'
    const treeRows = document.createElement('div')
    treeRows.className = 'k411-timeline-tree__rows'
    this.treeRows = treeRows
    tree.append(treeHeader, treeRows)

    const divider = document.createElement('div')
    divider.className = 'k411-timeline-divider'
    divider.setAttribute('role', 'separator')
    divider.setAttribute('aria-orientation', 'vertical')
    divider.addEventListener('pointerdown', this.startDividerDrag)

    const timelineScroll = document.createElement('div')
    timelineScroll.className = 'k411-timeline-scroll'
    timelineScroll.addEventListener('scroll', this.onTimelineScroll)
    this.timelineScroll = timelineScroll

    const surface = document.createElement('div')
    surface.className = 'k411-timeline-surface'
    this.surface = surface
    timelineScroll.appendChild(surface)

    body.append(tree, divider, timelineScroll)
    shell.append(toolbar, body)
    root.appendChild(shell)
    return root
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement('header')
    toolbar.className = 'k411-timeline-toolbar'

    const brand = document.createElement('strong')
    brand.className = 'k411-timeline-toolbar__brand'
    brand.textContent = 'Timeline 411'

    const playButton = createToolbarButton('▶', 'Reproducir')
    playButton.addEventListener('click', () => {
      const player = this.timeline.getPlayer(this.sheetId)
      if (player.playing) player.pause()
      else player.play({loop: true})
    })
    this.playButton = playButton

    const timeInput = document.createElement('input')
    timeInput.className = 'k411-timeline-time'
    timeInput.type = 'number'
    timeInput.min = '0'
    timeInput.step = '0.001'
    timeInput.setAttribute('aria-label', 'Posición actual en segundos')
    timeInput.addEventListener('change', () => {
      this.timeline.getPlayer(this.sheetId).seek(Number(timeInput.value))
    })
    this.timeInput = timeInput

    const duration = document.createElement('span')
    duration.className = 'k411-timeline-duration'
    duration.textContent = `/ ${this.timeline.getDuration(this.sheetId).toFixed(2)}s`

    const undoButton = createToolbarButton('↶', 'Deshacer')
    undoButton.addEventListener('click', () => this.timeline.store.undo())
    this.undoButton = undoButton

    const redoButton = createToolbarButton('↷', 'Rehacer')
    redoButton.addEventListener('click', () => this.timeline.store.redo())
    this.redoButton = redoButton

    const interpolation = document.createElement('select')
    interpolation.className = 'k411-timeline-preset'
    interpolation.setAttribute('aria-label', 'Interpolación del segmento')
    const presets: Array<[string, string]> = [
      ['', 'Interpolación'],
      ['linear', 'Linear'],
      ['hold', 'Hold'],
      ['ease', 'Ease'],
      ['easeIn', 'Ease In'],
      ['easeOut', 'Ease Out'],
      ['easeInOut', 'Ease In Out'],
    ]
    for (const [value, label] of presets) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      interpolation.appendChild(option)
    }
    interpolation.disabled = true
    interpolation.addEventListener('change', () => {
      if (!this.selected || !interpolation.value) return
      try {
        this.timeline.store.transaction('Cambiar interpolación', (transaction) => {
          transaction.setInterpolation(
            this.selected as KeyframeAddress,
            interpolation.value as EasingPreset,
          )
        })
      } catch (error) {
        console.warn(error)
      }
      interpolation.value = ''
    })
    this.interpolationSelect = interpolation

    const exportButton = createToolbarButton('JSON', 'Exportar animation.json')
    exportButton.classList.add('k411-timeline-toolbar__export')
    exportButton.addEventListener('click', () => this.downloadJson())

    toolbar.append(
      brand,
      playButton,
      timeInput,
      duration,
      undoButton,
      redoButton,
      interpolation,
      exportButton,
    )
    return toolbar
  }

  private render(): void {
    if (!this.root || !this.treeRows || !this.timelineScroll || !this.surface) return
    const rows = buildTimelineRows(this.timeline.document, this.sheetId)
    this.currentRows = rows
    const duration = this.timeline.getDuration(this.sheetId)
    const availableWidth = Math.max(1, this.timelineScroll.clientWidth)
    this.surfaceWidth = Math.max(availableWidth, duration * pixelsPerSecond)
    const contentHeight = rulerHeight + rows.length * rowHeight

    this.surface.style.width = `${this.surfaceWidth}px`
    this.surface.style.height = `${Math.max(contentHeight, this.timelineScroll.clientHeight)}px`
    this.surface.replaceChildren()
    this.treeRows.replaceChildren()
    this.treeRowElements.clear()

    const treeSurface = document.createElement('div')
    treeSurface.className = 'k411-timeline-tree__surface'
    treeSurface.style.height = `${rows.length * rowHeight}px`
    const position = this.timeline.getPlayer(this.sheetId).position
    const evaluated = this.timeline.evaluate(this.sheetId, position)
    for (const row of rows) {
      treeSurface.appendChild(
        this.createTreeRow(
          row,
          projectTimelineRowValue(
            this.timeline.document,
            this.sheetId,
            row,
            position,
            evaluated,
          ),
        ),
      )
    }
    this.treeRows.appendChild(treeSurface)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('k411-timeline-svg')
    svg.setAttribute('width', String(this.surfaceWidth))
    svg.setAttribute('height', String(Math.max(contentHeight, this.timelineScroll.clientHeight)))
    this.surface.appendChild(svg)

    const ruler = document.createElement('div')
    ruler.className = 'k411-timeline-ruler'
    ruler.addEventListener('pointerdown', this.startPlayheadDrag)
    this.surface.appendChild(ruler)

    const fps = this.timeline.getFps(this.sheetId)
    for (const tick of createGridTicks(duration, this.surfaceWidth, fps)) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(tick.x))
      line.setAttribute('x2', String(tick.x))
      line.setAttribute('y1', '0')
      line.setAttribute('y2', String(Math.max(contentHeight, this.timelineScroll.clientHeight)))
      line.classList.add(
        tick.major ? 'k411-timeline-grid--major' : 'k411-timeline-grid--minor',
      )
      svg.appendChild(line)

      const label = document.createElement('span')
      label.className = 'k411-timeline-ruler__tick'
      label.style.left = `${tick.x}px`
      label.textContent = tick.label
      ruler.appendChild(label)
    }

    rows.forEach((row, index) => {
      const y = rulerHeight + index * rowHeight
      const lane = document.createElement('div')
      lane.className = `k411-timeline-lane k411-timeline-lane--${row.kind}`
      lane.style.top = `${y}px`
      lane.style.height = `${rowHeight}px`
      if (row.trackId) {
        lane.addEventListener('dblclick', (event) => this.addKeyframe(event, row))
      }
      this.surface?.appendChild(lane)

      const keyframes = collectRowKeyframes(this.timeline.document, this.sheetId, row)
      if (row.trackId) {
        for (let keyframeIndex = 0; keyframeIndex < keyframes.length - 1; keyframeIndex += 1) {
          const left = keyframes[keyframeIndex]
          const right = keyframes[keyframeIndex + 1]
          const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          connector.setAttribute('x1', String(timeToX(left.position, duration, this.surfaceWidth)))
          connector.setAttribute('x2', String(timeToX(right.position, duration, this.surfaceWidth)))
          connector.setAttribute('y1', String(y + rowHeight / 2))
          connector.setAttribute('y2', String(y + rowHeight / 2))
          connector.classList.add('k411-timeline-connector')
          if (!left.connectedRight || left.type === 'hold') {
            connector.classList.add('k411-timeline-connector--hold')
          }
          svg.appendChild(connector)
        }
      }

      for (const keyframe of keyframes) {
        const x = timeToX(keyframe.position, duration, this.surfaceWidth)
        if (!row.trackId) {
          const aggregate = document.createElement('span')
          aggregate.className = 'k411-timeline-keyframe k411-timeline-keyframe--aggregate'
          aggregate.style.left = `${x}px`
          aggregate.style.top = `${y + rowHeight / 2}px`
          this.surface?.appendChild(aggregate)
          continue
        }

        const address: KeyframeAddress = {
          sheetId: this.sheetId,
          objectKey: row.objectKey,
          trackId: row.trackId,
          keyframeId: keyframe.id,
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'k411-timeline-keyframe'
        if (sameKeyframeAddress(this.selected, address)) {
          button.classList.add('k411-timeline-keyframe--selected')
        }
        button.style.left = `${x}px`
        button.style.top = `${y + rowHeight / 2}px`
        button.title = `${row.label}: ${keyframe.position.toFixed(3)}s`
        button.setAttribute('aria-label', button.title)
        button.addEventListener('pointerdown', (event) =>
          this.startKeyframeDrag(event, address),
        )
        button.addEventListener('click', () => {
          this.timeline.getPlayer(this.sheetId).seek(keyframe.position)
          this.selectKeyframe(address)
        })
        this.surface?.appendChild(button)
      }
    })

    const playhead = document.createElement('button')
    playhead.type = 'button'
    playhead.className = 'k411-timeline-playhead'
    playhead.setAttribute('aria-label', 'Playhead')
    playhead.addEventListener('pointerdown', this.startPlayheadDrag)
    this.surface.appendChild(playhead)
    this.updatePlayback()
    this.onTimelineScroll()
  }

  private createTreeRow(
    row: TimelineRow,
    value: TimelineRowValueProjection,
  ): HTMLElement {
    const element = document.createElement('div')
    element.className = `k411-timeline-tree-row k411-timeline-tree-row--${row.kind}`
    element.style.height = `${rowHeight}px`
    element.style.paddingLeft = `${10 + row.depth * 16}px`
    element.dataset.rowId = row.id

    const icon = document.createElement('span')
    icon.className = 'k411-timeline-tree-row__icon'
    icon.textContent = row.kind === 'object' ? '◆' : row.kind === 'group' ? '▾' : '·'
    const label = document.createElement('span')
    label.className = 'k411-timeline-tree-row__label'
    label.textContent = row.label
    const valueCell = document.createElement('span')
    valueCell.className = 'k411-timeline-tree-row__value'
    element.append(icon, label, valueCell)
    this.treeRowElements.set(row.id, element)
    this.renderRowValue(valueCell, row, value)
    return element
  }

  private updatePlayback(): void {
    if (!this.playButton || !this.timeInput || !this.surface) return
    const state = this.timeline.getPlayer(this.sheetId).snapshot
    this.playButton.textContent = state.playing ? '❚❚' : '▶'
    this.playButton.title = state.playing ? 'Pausar' : 'Reproducir'
    if (document.activeElement !== this.timeInput) {
      this.timeInput.value = state.position.toFixed(3)
    }
    const playhead = this.surface.querySelector<HTMLElement>(
      '.k411-timeline-playhead',
    )
    if (playhead) {
      playhead.style.left = `${timeToX(
        state.position,
        this.timeline.getDuration(this.sheetId),
        this.surfaceWidth,
      )}px`
    }
    this.updateTreeValues()
  }

  private updateTreeValues(): void {
    if (!this.treeRows || this.currentRows.length === 0) return
    const position = this.timeline.getPlayer(this.sheetId).position
    const evaluated = this.timeline.evaluate(this.sheetId, position)
    for (const row of this.currentRows) {
      const valueCell = this.treeRowElements
        .get(row.id)
        ?.querySelector<HTMLElement>('.k411-timeline-tree-row__value')
      if (!valueCell) continue
      this.renderRowValue(
        valueCell,
        row,
        projectTimelineRowValue(
          this.timeline.document,
          this.sheetId,
          row,
          position,
          evaluated,
        ),
      )
    }
  }

  private renderRowValue(
    cell: HTMLElement,
    row: TimelineRow,
    projection: TimelineRowValueProjection,
  ): void {
    if (cell.contains(document.activeElement)) return
    const property = this.getPropertyRef(row)
    const formatted = formatPropertyValue(projection.value, property?.config)
    const signature = JSON.stringify([
      projection.mode,
      formatted,
      projection.keyframe?.keyframeId,
    ])
    if (cell.dataset.valueSignature === signature) return
    cell.dataset.valueSignature = signature
    cell.classList.toggle(
      'k411-timeline-tree-row__value--editable',
      projection.mode === 'static' || projection.mode === 'keyframe',
    )
    cell.classList.toggle(
      'k411-timeline-tree-row__value--keyframe',
      projection.mode === 'keyframe',
    )
    cell.replaceChildren()

    if (projection.mode === 'hidden') return
    if (projection.mode === 'readonly') {
      const output = document.createElement('span')
      output.className = 'k411-timeline-value-output'
      output.textContent = formatted
      output.title = `Valor interpolado: ${fullValueLabel(projection.value)}`
      output.setAttribute('aria-label', `${row.label}: valor interpolado de solo lectura`)
      cell.appendChild(output)
      return
    }

    const editor = createValueEditor(projection.value, property?.config)
    editor.element.classList.add('k411-timeline-value-editor')
    editor.element.setAttribute('aria-label', `Editar valor de ${row.label}`)
    editor.element.title =
      projection.mode === 'keyframe'
        ? 'Editar valor del keyframe'
        : 'Editar valor estático'

    let dirty = false
    let finished = false
    editor.element.addEventListener('input', () => {
      dirty = true
    })
    const finish = (commit: boolean): void => {
      if (finished) return
      if (commit && dirty) {
        try {
          if (!this.commitRowValue(row, projection, property, editor.read())) return
        } catch (error) {
          console.warn(error)
          return
        }
      }
      finished = true
      if (!commit) cell.dataset.valueSignature = ''
    }
    editor.element.addEventListener('keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent
      keyboardEvent.stopPropagation()
      if (keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        finish(true)
        editor.element.blur()
      } else if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault()
        finish(false)
        editor.element.blur()
        this.updateTreeValues()
      }
    })
    editor.element.addEventListener('blur', () => finish(true))
    if (
      editor.element instanceof HTMLSelectElement ||
      (editor.element instanceof HTMLInputElement &&
        editor.element.type === 'checkbox')
    ) {
      editor.element.addEventListener('change', () => {
        dirty = true
        finish(true)
      })
    }
    cell.appendChild(editor.element)
  }

  private commitRowValue(
    row: TimelineRow,
    projection: TimelineRowValueProjection,
    property: TimelinePropertyRef | undefined,
    rawValue: unknown,
  ): boolean {
    try {
      const sanitized = property ? property.config.sanitize(rawValue) : rawValue
      if (typeof sanitized === 'undefined') {
        throw new Error(`Valor inválido para ${row.path.join('.')}`)
      }
      const value = sanitized as SerializableValue
      if (projection.mode === 'keyframe' && projection.keyframe) {
        this.timeline.editor.transaction(
          (transaction) => {
            transaction.updateKeyframe(projection.keyframe as KeyframeAddress, {
              value,
            })
          },
          {label: `Editar ${row.label}`},
        )
      } else if (projection.mode === 'static') {
        if (property) {
          this.timeline.editor.transaction(
            (transaction) => transaction.set(property, value),
            {label: `Editar ${row.label}`},
          )
        } else {
          this.timeline.store.transaction(`Editar ${row.label}`, (transaction) => {
            transaction.setStaticValue(
              {sheetId: this.sheetId, objectKey: row.objectKey, path: row.path},
              value,
            )
          })
        }
      }
      return true
    } catch (error) {
      console.warn(error)
      return false
    }
  }

  private getPropertyRef(row: TimelineRow): TimelinePropertyRef | undefined {
    return this.timeline
      .getComposition(this.sheetId)
      ?.getObject(row.objectKey)
      ?.getProperty(row.path)
  }

  private updateHistory(): void {
    const history = this.timeline.store.history
    if (this.undoButton) {
      this.undoButton.disabled = !history.canUndo
      this.undoButton.title = history.undoLabel
        ? `Deshacer: ${history.undoLabel}`
        : 'Deshacer'
    }
    if (this.redoButton) {
      this.redoButton.disabled = !history.canRedo
      this.redoButton.title = history.redoLabel
        ? `Rehacer: ${history.redoLabel}`
        : 'Rehacer'
    }
  }

  private selectKeyframe(address?: KeyframeAddress): void {
    this.selected = address
    if (this.interpolationSelect) this.interpolationSelect.disabled = !address
    this.events.emit('selection:change', {selection: address})
    this.render()
    this.root?.focus({preventScroll: true})
  }

  private addKeyframe(event: MouseEvent, row: TimelineRow): void {
    if (!row.trackId || !this.surface) return
    const track = getTrack(this.timeline.document, {
      sheetId: this.sheetId,
      objectKey: row.objectKey,
      trackId: row.trackId,
    })
    const time = this.timeFromClientX(event.clientX, true)
    const value = evaluateTrack(track, time)
    if (typeof value === 'undefined') return
    let keyframeId = ''
    this.timeline.store.transaction('Añadir keyframe', (transaction) => {
      keyframeId = transaction.addKeyframe(
        {sheetId: this.sheetId, objectKey: row.objectKey, trackId: row.trackId as string},
        {position: time, value},
      )
    })
    this.timeline.getPlayer(this.sheetId).seek(time)
    this.selectKeyframe({
      sheetId: this.sheetId,
      objectKey: row.objectKey,
      trackId: row.trackId,
      keyframeId,
    })
  }

  private readonly startKeyframeDrag = (
    event: PointerEvent,
    address: KeyframeAddress,
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const player = this.timeline.getPlayer(this.sheetId)
    player.pause()
    const selectedKeyframe = getTrack(this.timeline.document, address).keyframes.find(
      (keyframe) => keyframe.id === address.keyframeId,
    )
    if (selectedKeyframe) player.seek(selectedKeyframe.position)
    this.selected = address
    this.interpolationSelect && (this.interpolationSelect.disabled = false)
    this.events.emit('selection:change', {selection: address})
    this.cancelPointerInteraction?.()
    const gesture = this.timeline.store.beginGesture('Mover keyframe')
    this.activeGesture = gesture

    const move = (moveEvent: PointerEvent): void => {
      const position = this.timeFromClientX(moveEvent.clientX, true)
      gesture.update((transaction) => {
        transaction.updateKeyframe(address, {position})
      })
      player.seek(position)
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      if (this.cancelPointerInteraction === cancel) {
        this.cancelPointerInteraction = undefined
      }
      if (gesture.active) gesture.commit()
      if (this.activeGesture === gesture) this.activeGesture = undefined
    }
    const cancel = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      if (this.cancelPointerInteraction === cancel) {
        this.cancelPointerInteraction = undefined
      }
      if (gesture.active) gesture.cancel()
      if (this.activeGesture === gesture) this.activeGesture = undefined
    }
    this.cancelPointerInteraction = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, {once: true})
    window.addEventListener('pointercancel', cancel, {once: true})
  }

  private readonly startPlayheadDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    this.timeline.getPlayer(this.sheetId).pause()
    const move = (moveEvent: PointerEvent): void => {
      this.timeline
        .getPlayer(this.sheetId)
        .seek(this.timeFromClientX(moveEvent.clientX, true))
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    move(event)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, {once: true})
  }

  private readonly startDividerDrag = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.root) return
    event.preventDefault()
    const rootRect = this.root.getBoundingClientRect()
    const move = (moveEvent: PointerEvent): void => {
      const max = Math.min(480, Math.max(160, rootRect.width * 0.45))
      this.treeWidth = Math.max(160, Math.min(max, moveEvent.clientX - rootRect.left))
      const tree = this.root?.querySelector<HTMLElement>('.k411-timeline-tree')
      if (tree) tree.style.width = `${this.treeWidth}px`
      this.events.emit('panel:resize', {width: this.treeWidth})
      this.render()
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, {once: true})
  }

  private readonly onTimelineScroll = (): void => {
    if (!this.timelineScroll || !this.treeRows) return
    this.treeRows.scrollTop = Math.max(0, this.timelineScroll.scrollTop - rulerHeight)
    this.events.emit('viewport:change', {
      scrollLeft: this.timelineScroll.scrollLeft,
      scrollTop: this.timelineScroll.scrollTop,
    })
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelActiveGesture()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected) {
      event.preventDefault()
      const selected = this.selected
      this.timeline.store.transaction('Eliminar keyframe', (transaction) => {
        transaction.removeKeyframe(selected)
      })
      this.selectKeyframe(undefined)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) this.timeline.store.redo()
      else this.timeline.store.undo()
    }
  }

  private cancelActiveGesture(): void {
    if (this.cancelPointerInteraction) this.cancelPointerInteraction()
    else if (this.activeGesture?.active) this.activeGesture.cancel()
    this.cancelPointerInteraction = undefined
    this.activeGesture = undefined
  }

  private timeFromClientX(clientX: number, snap: boolean): number {
    if (!this.surface) return 0
    const rect = this.surface.getBoundingClientRect()
    const time = xToTime(
      clientX - rect.left,
      this.timeline.getDuration(this.sheetId),
      this.surfaceWidth,
    )
    return snap ? snapToFrame(time, this.timeline.getFps(this.sheetId)) : time
  }

  private downloadJson(): void {
    const blob = new Blob([this.timeline.stringify(2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'animation.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

interface ValueEditor {
  readonly element: HTMLInputElement | HTMLSelectElement
  read(): unknown
}

function createValueEditor(
  value: SerializableValue | undefined,
  config?: TimelinePropTypeConfig,
): ValueEditor {
  if (config?.type === 'stringLiteral') {
    const select = document.createElement('select')
    for (const [optionValue, label] of Object.entries(config.valuesAndLabels)) {
      const option = document.createElement('option')
      option.value = optionValue
      option.textContent = label
      option.selected = optionValue === value
      select.appendChild(option)
    }
    return {element: select, read: () => select.value}
  }

  if (config?.type === 'boolean' || (!config && typeof value === 'boolean')) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value === true
    return {element: input, read: () => input.checked}
  }

  const input = document.createElement('input')
  input.autocomplete = 'off'
  if (config?.type === 'number' || (!config && typeof value === 'number')) {
    input.type = 'number'
    input.inputMode = 'decimal'
    input.step =
      config?.type === 'number' && config.nudgeMultiplier
        ? String(config.nudgeMultiplier)
        : 'any'
    input.value = typeof value === 'number' ? formatNumber(value) : ''
    return {
      element: input,
      read: () => {
        const parsed = Number(input.value)
        if (input.value.trim() === '' || !Number.isFinite(parsed)) {
          throw new Error('El valor numérico debe ser finito')
        }
        return parsed
      },
    }
  }

  if (config?.type === 'rgba') {
    input.type = 'text'
    input.value = isSerializableMap(value)
      ? [value.r, value.g, value.b, value.a].map(formatUnknownNumber).join(', ')
      : ''
    return {
      element: input,
      read: () => {
        const channels = input.value.split(',').map((channel) => Number(channel.trim()))
        if (channels.length !== 4 || channels.some((channel) => !Number.isFinite(channel))) {
          throw new Error('RGBA necesita cuatro números: r, g, b, a')
        }
        return {r: channels[0], g: channels[1], b: channels[2], a: channels[3]}
      },
    }
  }

  if (config?.type === 'image' || config?.type === 'file') {
    input.type = 'text'
    input.value = isSerializableMap(value) && typeof value.id === 'string' ? value.id : ''
    return {
      element: input,
      read: () =>
        input.value === ''
          ? {type: config.type}
          : {type: config.type, id: input.value},
    }
  }

  if (config?.type === 'compound' || isSerializableMap(value)) {
    input.type = 'text'
    input.value = JSON.stringify(value ?? {})
    return {element: input, read: () => JSON.parse(input.value) as unknown}
  }

  input.type = 'text'
  input.value = typeof value === 'string' ? value : ''
  return {element: input, read: () => input.value}
}

function formatPropertyValue(
  value: SerializableValue | undefined,
  config?: TimelinePropTypeConfig,
): string {
  if (typeof value === 'undefined') return '—'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (config?.type === 'rgba' && isSerializableMap(value)) {
    return [value.r, value.g, value.b, value.a].map(formatUnknownNumber).join(', ')
  }
  if (
    (config?.type === 'image' || config?.type === 'file') &&
    isSerializableMap(value)
  ) {
    return typeof value.id === 'string' ? value.id : '—'
  }
  return JSON.stringify(value) ?? '—'
}

function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(3))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function formatUnknownNumber(value: SerializableValue | undefined): string {
  return typeof value === 'number' ? formatNumber(value) : '0'
}

function fullValueLabel(value: SerializableValue | undefined): string {
  if (typeof value === 'undefined') return 'sin valor'
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'sin valor')
}

function createToolbarButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'k411-timeline-toolbar__button'
  button.textContent = label
  button.title = title
  return button
}

function resolveMountTarget(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target
  const matches = document.querySelectorAll<HTMLElement>(target)
  if (matches.length === 0) throw new Error(`No existe el selector: ${target}`)
  if (matches.length > 1) throw new Error(`El selector es ambiguo: ${target}`)
  return matches[0]
}

function sameKeyframeAddress(
  left: KeyframeAddress | undefined,
  right: KeyframeAddress,
): boolean {
  return (
    left?.sheetId === right.sheetId &&
    left.objectKey === right.objectKey &&
    left.trackId === right.trackId &&
    left.keyframeId === right.keyframeId
  )
}

function getTrack(
  document: TimelineDocument,
  address: TrackAddress,
): TheatreBasicKeyframedTrack {
  const track =
    document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
      address.objectKey
    ]?.trackData[address.trackId]
  if (!track) throw new Error(`Track desconocido: ${address.trackId}`)
  return track
}
