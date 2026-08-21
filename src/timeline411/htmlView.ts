import './timeline411.css'
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
  createViewportGridTicks,
  projectTimelineRowValue,
  snapToFrame,
} from './projection'
import type {TimelineRow, TimelineRowValueProjection} from './projection'
import {
  keyframeAddressKey,
  sameKeyframeAddress,
  TimelineKeyframeSelection,
} from './selection'
import type {TimelineKeyframeSelectionSnapshot} from './selection'
import {easingPresetPoints} from './store'
import type {EditingGesture} from './store'
import {Timeline411} from './timeline'
import type {
  TimelineViewportChange,
  TimelineViewportChangeReason,
} from './viewport'
import {
  getViewportScrollLeft,
  getViewportVirtualWidth,
  scrollLeftToVisibleStart,
  timeToViewportSurfaceX,
  TimelineViewport,
  viewportXToTime,
} from './viewport'

const rowHeight = 28
const rulerHeight = 30
const minimumWidth = 640
const minimumHeight = 240

export interface Timeline411ViewEvents {
  'selection:change': TimelineKeyframeSelectionSnapshot
  'view:resize': {width: number; height: number}
  'viewport:change': {
    scrollLeft: number
    scrollTop: number
    visibleRange: readonly [number, number]
    zoom: number
    reason: TimelineViewportChangeReason
  }
  'panel:resize': {width: number}
}

interface KeyframeDragSnapshot {
  readonly address: KeyframeAddress
  readonly position: number
}

export class Timeline411HtmlView {
  readonly viewport: TimelineViewport
  private readonly events = new TypedEventEmitter<Timeline411ViewEvents>()
  private root?: HTMLElement
  private treeRows?: HTMLElement
  private timelineScroll?: HTMLElement
  private surface?: HTMLElement
  private playButton?: HTMLButtonElement
  private undoButton?: HTMLButtonElement
  private redoButton?: HTMLButtonElement
  private timeInput?: HTMLInputElement
  private durationInput?: HTMLInputElement
  private keyframeTimeInput?: HTMLInputElement
  private keyframeContext?: HTMLElement
  private interpolationSelect?: HTMLSelectElement
  private resizeObserver?: ResizeObserver
  private readonly keyframeSelection = new TimelineKeyframeSelection()
  private activeGesture?: EditingGesture
  private cancelPointerInteraction?: () => void
  private treeWidth = 240
  private surfaceWidth = 1
  private spacePressed = false
  private lastScrollTop = 0
  private durationEditDirty = false
  private keyframeTimeEditDirty = false
  private currentRows: readonly TimelineRow[] = []
  private readonly treeRowElements = new Map<string, HTMLElement>()
  private readonly unsubscribers: Array<() => void> = []

  private get selected(): KeyframeAddress | undefined {
    return this.keyframeSelection.primary
  }

  get selection(): TimelineKeyframeSelectionSnapshot {
    return this.keyframeSelection.snapshot
  }

  constructor(
    private readonly timeline: Timeline411,
    private readonly sheetId: string,
  ) {
    this.viewport = new TimelineViewport({
      duration: timeline.getDuration(sheetId),
      fps: timeline.getFps(sheetId),
    })
  }

  mount(target: string | HTMLElement): void {
    if (this.root) throw new Error('La vista Timeline 411 ya está montada')
    const container = resolveMountTarget(target)
    if (container.querySelector('[data-timeline411-view]')) {
      throw new Error('El contenedor ya tiene una vista Timeline 411')
    }
    this.root = this.createRoot()
    container.appendChild(this.root)
    this.syncViewportMetrics()

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.syncViewportMetrics()) this.render()
      this.events.emit('view:resize', {
        width: container.clientWidth,
        height: container.clientHeight,
      })
    })
    this.resizeObserver.observe(container)

    this.unsubscribers.push(
      this.timeline.store.subscribe(() => {
        if (!this.syncViewportMetrics()) this.render()
      }, false),
      this.timeline
        .getPlayer(this.sheetId)
        .subscribe(() => this.updatePlayback(), false),
      this.timeline.on('history:change', () => this.updateHistory()),
      this.viewport.onChange(this.onViewportChange),
    )
    this.root.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
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
    window.removeEventListener('keyup', this.onKeyUp)
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
    timelineScroll.addEventListener('wheel', this.onTimelineWheel, {passive: false})
    timelineScroll.addEventListener('pointerdown', this.startPanDrag)
    this.timelineScroll = timelineScroll

    const surface = document.createElement('div')
    surface.className = 'k411-timeline-surface'
    surface.addEventListener('click', this.onSurfaceClick)
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

    const basicBlock = document.createElement('div')
    basicBlock.className = 'k411-timeline-toolbar__basic'

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

    const duration = document.createElement('label')
    duration.className = 'k411-timeline-duration'
    const durationSeparator = document.createElement('span')
    durationSeparator.textContent = '/'
    const durationInput = document.createElement('input')
    durationInput.className = 'k411-timeline-duration-input'
    durationInput.type = 'number'
    durationInput.min = '0.000001'
    durationInput.step = '0.001'
    durationInput.setAttribute('aria-label', 'Duración total en segundos')
    durationInput.title = 'Editar duración total'
    durationInput.addEventListener('focus', () => {
      if (!this.durationEditDirty) durationInput.setCustomValidity('')
    })
    durationInput.addEventListener('input', () => {
      this.durationEditDirty = true
      durationInput.setCustomValidity('')
    })
    durationInput.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        if (this.commitDurationInput()) durationInput.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.durationEditDirty = false
        durationInput.setCustomValidity('')
        this.updateDurationInput(true)
        durationInput.blur()
      }
    })
    durationInput.addEventListener('blur', () => {
      if (this.durationEditDirty) this.commitDurationInput()
    })
    const durationSuffix = document.createElement('span')
    durationSuffix.textContent = 's'
    duration.append(durationSeparator, durationInput, durationSuffix)
    this.durationInput = durationInput
    this.updateDurationInput(true)
    basicBlock.append(brand, playButton, timeInput, duration)

    const keyframeTime = document.createElement('label')
    keyframeTime.className = 'k411-timeline-keyframe-time'
    const keyframeTimeLabel = document.createElement('span')
    keyframeTimeLabel.textContent = 'Tiempo:'
    const keyframeTimeInput = document.createElement('input')
    keyframeTimeInput.className = 'k411-timeline-keyframe-time-input'
    keyframeTimeInput.type = 'number'
    keyframeTimeInput.min = '0'
    keyframeTimeInput.step = String(1 / this.timeline.getFps(this.sheetId))
    keyframeTimeInput.disabled = true
    keyframeTimeInput.setAttribute(
      'aria-label',
      'Tiempo del keyframe seleccionado en segundos',
    )
    keyframeTimeInput.title = 'Editar tiempo del keyframe seleccionado'
    keyframeTimeInput.addEventListener('focus', () => {
      if (!this.keyframeTimeEditDirty) keyframeTimeInput.setCustomValidity('')
    })
    keyframeTimeInput.addEventListener('input', () => {
      this.keyframeTimeEditDirty = true
      keyframeTimeInput.setCustomValidity('')
    })
    keyframeTimeInput.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        if (this.commitKeyframeTimeInput()) keyframeTimeInput.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.keyframeTimeEditDirty = false
        keyframeTimeInput.setCustomValidity('')
        this.updateKeyframeTimeInput(true)
        keyframeTimeInput.blur()
      }
    })
    keyframeTimeInput.addEventListener('blur', () => {
      if (this.keyframeTimeEditDirty) this.commitKeyframeTimeInput()
    })
    const keyframeTimeSuffix = document.createElement('span')
    keyframeTimeSuffix.textContent = 's'
    keyframeTime.append(
      keyframeTimeLabel,
      keyframeTimeInput,
      keyframeTimeSuffix,
    )
    this.keyframeTimeInput = keyframeTimeInput

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
      ['none', 'Sin segmento'],
      ['imported', 'Curva importada'],
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
      if (value === 'none' || value === 'imported') option.disabled = true
      interpolation.appendChild(option)
    }
    interpolation.disabled = true
    interpolation.addEventListener('change', () => {
      const preset = interpolation.value
      if (
        this.keyframeSelection.size !== 1 ||
        !this.selected ||
        !isEasingPreset(preset)
      ) {
        this.updateInterpolationSelect()
        return
      }
      try {
        const selected = this.selected
        this.timeline.editor.transaction(
          (transaction) => {
            transaction.setInterpolation(selected, preset)
          },
          {label: 'Cambiar interpolación'},
        )
      } catch (error) {
        console.warn(error)
      }
      this.updateInterpolationSelect()
    })
    this.interpolationSelect = interpolation

    const keyframeContext = document.createElement('section')
    keyframeContext.className = 'k411-timeline-toolbar__keyframe-context'
    keyframeContext.setAttribute('aria-label', 'Keyframe seleccionado')
    keyframeContext.hidden = true
    const keyframeContextTitle = document.createElement('strong')
    keyframeContextTitle.className = 'k411-timeline-toolbar__context-title'
    keyframeContextTitle.textContent = 'KF seleccionado:'
    const interpolationLabel = document.createElement('label')
    interpolationLabel.className = 'k411-timeline-interpolation'
    const interpolationText = document.createElement('span')
    interpolationText.textContent = 'Interpolación:'
    interpolationLabel.append(interpolationText, interpolation)
    keyframeContext.append(
      keyframeContextTitle,
      keyframeTime,
      interpolationLabel,
    )
    this.keyframeContext = keyframeContext
    this.updateKeyframeTimeInput(true)
    this.updateInterpolationSelect()

    const exportButton = createToolbarButton('JSON', 'Exportar animation.json')
    exportButton.classList.add('k411-timeline-toolbar__export')
    exportButton.addEventListener('click', () => this.downloadJson())

    const actions = document.createElement('div')
    actions.className = 'k411-timeline-toolbar__actions'
    actions.append(undoButton, redoButton, exportButton)

    toolbar.append(basicBlock, keyframeContext, actions)
    return toolbar
  }

  private render(): void {
    if (!this.root || !this.treeRows || !this.timelineScroll || !this.surface) return
    this.pruneInvalidKeyframeSelection()
    this.updateDurationInput()
    this.updateKeyframeTimeInput()
    this.updateInterpolationSelect()
    const rows = buildTimelineRows(this.timeline.document, this.sheetId)
    this.currentRows = rows
    const viewport = this.viewport.snapshot
    const desiredScrollLeft = getViewportScrollLeft(viewport)
    this.surfaceWidth = getViewportVirtualWidth(viewport)
    const contentHeight = rulerHeight + rows.length * rowHeight

    this.surface.style.width = `${this.surfaceWidth}px`
    this.surface.style.height = `${Math.max(contentHeight, this.timelineScroll.clientHeight)}px`
    this.timelineScroll.scrollLeft = desiredScrollLeft
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
    ruler.addEventListener('dblclick', () => this.viewport.fitToSequence())
    this.surface.appendChild(ruler)

    const gridOffset = desiredScrollLeft
    for (const tick of createViewportGridTicks(viewport)) {
      const tickX = gridOffset + tick.x
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(tickX))
      line.setAttribute('x2', String(tickX))
      line.setAttribute('y1', '0')
      line.setAttribute('y2', String(Math.max(contentHeight, this.timelineScroll.clientHeight)))
      line.classList.add(
        tick.major ? 'k411-timeline-grid--major' : 'k411-timeline-grid--minor',
      )
      svg.appendChild(line)

      const label = document.createElement('span')
      label.className = 'k411-timeline-ruler__tick'
      label.style.left = `${tickX}px`
      label.textContent = tick.label
      ruler.appendChild(label)
    }

    rows.forEach((row, index) => {
      const y = rulerHeight + index * rowHeight
      const lane = document.createElement('div')
      lane.className = `k411-timeline-lane k411-timeline-lane--${row.kind}`
      lane.dataset.rowId = row.id
      lane.style.top = `${y}px`
      lane.style.height = `${rowHeight}px`
      if (isPrimitivePropertyRow(row)) {
        lane.addEventListener('dblclick', (event) => {
          event.preventDefault()
          this.toggleKeyframe(row, this.timeFromClientX(event.clientX, true))
        })
      }
      this.surface?.appendChild(lane)

      const keyframes = collectRowKeyframes(this.timeline.document, this.sheetId, row)
      if (row.trackId) {
        for (let keyframeIndex = 0; keyframeIndex < keyframes.length - 1; keyframeIndex += 1) {
          const left = keyframes[keyframeIndex]
          const right = keyframes[keyframeIndex + 1]
          const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          connector.setAttribute('x1', String(timeToViewportSurfaceX(left.position, viewport)))
          connector.setAttribute('x2', String(timeToViewportSurfaceX(right.position, viewport)))
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
        const x = timeToViewportSurfaceX(keyframe.position, viewport)
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
        if (this.keyframeSelection.has(address)) {
          button.classList.add('k411-timeline-keyframe--selected')
          button.setAttribute('aria-pressed', 'true')
        } else {
          button.setAttribute('aria-pressed', 'false')
        }
        if (sameKeyframeAddress(this.selected, address)) {
          button.classList.add('k411-timeline-keyframe--primary')
        }
        button.style.left = `${x}px`
        button.style.top = `${y + rowHeight / 2}px`
        button.title = `${row.label}: ${keyframe.position.toFixed(3)}s`
        button.setAttribute('aria-label', button.title)
        button.addEventListener('pointerdown', (event) =>
          this.startKeyframeDrag(event, address),
        )
        button.addEventListener('click', (event) => {
          const modifier = event.ctrlKey || event.metaKey
          if (!modifier && event.detail !== 0) return
          const current = findKeyframe(this.timeline.document, address)
          if (current) this.timeline.getPlayer(this.sheetId).seek(current.position)
          this.selectKeyframe(address, modifier ? 'toggle' : 'replace')
        })
        this.surface?.appendChild(button)
      }
    })

    const playhead = document.createElement('span')
    playhead.className = 'k411-timeline-playhead'
    playhead.setAttribute('aria-hidden', 'true')

    const playheadHandle = document.createElement('button')
    playheadHandle.type = 'button'
    playheadHandle.className = 'k411-timeline-playhead-handle'
    playheadHandle.setAttribute('aria-label', 'Mover cabeza reproductora')
    playheadHandle.title = 'Arrastrar cabeza reproductora'
    playheadHandle.addEventListener('pointerdown', this.startPlayheadDrag)
    this.surface.append(playhead, playheadHandle)
    this.updatePlayback()
    this.syncTreeScroll()
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
    if (isPrimitivePropertyRow(row)) {
      const keyframeToggle = document.createElement('button')
      keyframeToggle.type = 'button'
      keyframeToggle.className = 'k411-timeline-tree-row__keyframe-toggle'
      keyframeToggle.addEventListener('click', (event) => {
        event.stopPropagation()
        this.toggleKeyframe(
          row,
          this.timeline.getPlayer(this.sheetId).position,
        )
      })
      this.updateKeyframeToggle(keyframeToggle, row, value)
      element.appendChild(keyframeToggle)
    }
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
      const left = `${timeToViewportSurfaceX(
        state.position,
        this.viewport.snapshot,
      )}px`
      playhead.style.left = left
      const handle = this.surface.querySelector<HTMLElement>(
        '.k411-timeline-playhead-handle',
      )
      if (handle) handle.style.left = left
    }
    this.updateTreeValues()
  }

  private updateDurationInput(force = false): void {
    if (!this.durationInput) return
    if (!force && this.durationEditDirty && document.activeElement === this.durationInput) {
      return
    }
    this.durationInput.value = formatDuration(
      this.timeline.getDuration(this.sheetId),
    )
  }

  private commitDurationInput(): boolean {
    if (!this.durationInput) return false
    const duration = Number(this.durationInput.value)
    if (!Number.isFinite(duration) || duration <= 0) {
      this.durationInput.setCustomValidity(
        'La duración debe ser un número mayor que cero',
      )
      this.durationInput.reportValidity()
      return false
    }

    this.durationInput.setCustomValidity('')
    this.durationEditDirty = false
    if (Math.abs(duration - this.timeline.getDuration(this.sheetId)) > 1e-9) {
      try {
        this.timeline.editor.transaction(
          (transaction) => transaction.setDuration(this.sheetId, duration),
          {label: `Cambiar duración a ${formatDuration(duration)}s`},
        )
      } catch (error) {
        this.durationEditDirty = true
        this.durationInput.setCustomValidity('No se pudo cambiar la duración')
        this.durationInput.reportValidity()
        console.warn(error)
        return false
      }
    }
    this.updateDurationInput(true)
    return true
  }

  private updateKeyframeTimeInput(force = false): void {
    if (!this.keyframeTimeInput) return
    const selected =
      this.keyframeSelection.size === 1 ? this.selected : undefined
    const keyframe = selected
      ? findKeyframe(this.timeline.document, selected)
      : undefined
    if (!selected || !keyframe) {
      this.keyframeTimeEditDirty = false
      this.keyframeTimeInput.disabled = true
      this.keyframeTimeInput.value = ''
      this.keyframeTimeInput.title =
        'Selecciona un keyframe para editar su tiempo'
      if (this.keyframeContext) this.keyframeContext.hidden = true
      this.keyframeTimeInput.setCustomValidity('')
      if (this.interpolationSelect) this.interpolationSelect.disabled = true
      return
    }
    if (this.keyframeContext) this.keyframeContext.hidden = false
    this.keyframeTimeInput.disabled = false
    this.keyframeTimeInput.title = 'Editar tiempo del keyframe seleccionado'
    this.keyframeTimeInput.step = String(1 / this.timeline.getFps(this.sheetId))
    if (
      !force &&
      this.keyframeTimeEditDirty &&
      document.activeElement === this.keyframeTimeInput
    ) {
      return
    }
    this.keyframeTimeInput.value = formatKeyframeTime(keyframe.position)
  }

  private updateInterpolationSelect(): void {
    if (!this.interpolationSelect) return
    if (this.keyframeSelection.size !== 1 || !this.selected) {
      this.interpolationSelect.value = 'none'
      this.interpolationSelect.disabled = true
      return
    }
    const easing = getKeyframeEasing(this.timeline.document, this.selected)
    this.interpolationSelect.value = easing
    this.interpolationSelect.disabled = easing === 'none'
  }

  private commitKeyframeTimeInput(): boolean {
    if (
      !this.keyframeTimeInput ||
      this.keyframeSelection.size !== 1 ||
      !this.selected
    ) return false
    const input = this.keyframeTimeInput
    const keyframe = findKeyframe(this.timeline.document, this.selected)
    if (!keyframe) {
      this.updateKeyframeTimeInput(true)
      return false
    }

    const requestedTime = Number(input.value)
    const duration = this.timeline.getDuration(this.sheetId)
    if (
      input.value.trim() === '' ||
      !Number.isFinite(requestedTime) ||
      requestedTime < 0 ||
      requestedTime > duration
    ) {
      input.setCustomValidity(
        `El tiempo debe estar entre 0 y ${formatDuration(duration)} segundos`,
      )
      input.reportValidity()
      return false
    }

    const snappedTime = snapToFrame(
      requestedTime,
      this.timeline.getFps(this.sheetId),
    )
    if (snappedTime < 0 || snappedTime > duration) {
      input.setCustomValidity(
        `El frame más cercano queda fuera del rango 0–${formatDuration(duration)}s`,
      )
      input.reportValidity()
      return false
    }

    const track = getTrack(this.timeline.document, this.selected)
    const collides = track.keyframes.some(
      (candidate) =>
        candidate.id !== this.selected?.keyframeId &&
        Math.abs(candidate.position - snappedTime) < 1e-9,
    )
    if (collides) {
      input.setCustomValidity(
        'Ya existe otro keyframe en ese frame dentro del mismo track',
      )
      input.reportValidity()
      return false
    }

    input.setCustomValidity('')
    this.keyframeTimeEditDirty = false
    if (Math.abs(keyframe.position - snappedTime) > 1e-9) {
      try {
        const selected = this.selected
        this.timeline.editor.transaction(
          (transaction) =>
            transaction.updateKeyframe(selected, {position: snappedTime}),
          {label: `Mover keyframe a ${formatKeyframeTime(snappedTime)}s`},
        )
      } catch (error) {
        this.keyframeTimeEditDirty = true
        input.setCustomValidity('No se pudo cambiar el tiempo del keyframe')
        input.reportValidity()
        console.warn(error)
        return false
      }
    }
    this.timeline.getPlayer(this.sheetId).seek(snappedTime)
    this.updateKeyframeTimeInput(true)
    return true
  }

  private updateTreeValues(): void {
    if (!this.treeRows || this.currentRows.length === 0) return
    const position = this.timeline.getPlayer(this.sheetId).position
    const evaluated = this.timeline.evaluate(this.sheetId, position)
    for (const row of this.currentRows) {
      const rowElement = this.treeRowElements.get(row.id)
      const valueCell = rowElement?.querySelector<HTMLElement>(
        '.k411-timeline-tree-row__value',
      )
      if (!valueCell) continue
      const projection = projectTimelineRowValue(
        this.timeline.document,
        this.sheetId,
        row,
        position,
        evaluated,
      )
      this.renderRowValue(valueCell, row, projection)
      const keyframeToggle = rowElement?.querySelector<HTMLButtonElement>(
        '.k411-timeline-tree-row__keyframe-toggle',
      )
      if (keyframeToggle) {
        this.updateKeyframeToggle(keyframeToggle, row, projection)
      }
    }
  }

  private updateKeyframeToggle(
    button: HTMLButtonElement,
    row: TimelineRow,
    projection: TimelineRowValueProjection,
  ): void {
    const hasKeyframe = projection.mode === 'keyframe'
    button.textContent = hasKeyframe ? '◆' : '◇'
    button.classList.toggle(
      'k411-timeline-tree-row__keyframe-toggle--active',
      hasKeyframe,
    )
    button.setAttribute('aria-pressed', String(hasKeyframe))
    button.setAttribute(
      'aria-label',
      hasKeyframe
        ? `Quitar keyframe de ${row.label}`
        : `Añadir keyframe a ${row.label}`,
    )
    button.title = hasKeyframe
      ? 'Quitar keyframe en el playhead'
      : 'Añadir keyframe en el playhead'
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

  private selectKeyframe(
    address?: KeyframeAddress,
    mode: 'replace' | 'toggle' = 'replace',
    render = true,
  ): void {
    const changed = address && mode === 'toggle'
      ? this.keyframeSelection.toggle(address)
      : this.keyframeSelection.replace(address)
    if (changed) this.emitKeyframeSelectionChange()
    if (render) this.render()
    else {
      this.updateKeyframeTimeInput(true)
      this.updateInterpolationSelect()
    }
    this.root?.focus({preventScroll: true})
  }

  private makeKeyframePrimary(address: KeyframeAddress): void {
    if (!this.keyframeSelection.makePrimary(address)) return
    this.emitKeyframeSelectionChange()
    this.updateKeyframeTimeInput(true)
    this.updateInterpolationSelect()
  }

  private pruneInvalidKeyframeSelection(): void {
    if (
      !this.keyframeSelection.retain((address) =>
        Boolean(findKeyframe(this.timeline.document, address)),
      )
    ) return
    this.emitKeyframeSelectionChange()
  }

  private emitKeyframeSelectionChange(): void {
    this.events.emit('selection:change', this.keyframeSelection.snapshot)
  }

  private clearKeyframeSelectionFromSurface(): void {
    if (!this.keyframeSelection.clear()) return
    if (this.interpolationSelect) this.interpolationSelect.disabled = true
    this.surface
      ?.querySelectorAll('.k411-timeline-keyframe--selected, .k411-timeline-keyframe--primary')
      .forEach((element) => {
        element.classList.remove(
          'k411-timeline-keyframe--selected',
          'k411-timeline-keyframe--primary',
        )
        element.setAttribute('aria-pressed', 'false')
      })
    this.updateKeyframeTimeInput(true)
    this.updateInterpolationSelect()
    this.emitKeyframeSelectionChange()
    this.root?.focus({preventScroll: true})
  }

  private toggleKeyframe(row: TimelineRow, requestedTime: number): void {
    if (!isPrimitivePropertyRow(row)) return
    const time = snapToFrame(requestedTime, this.timeline.getFps(this.sheetId))
    const target =
      this.getPropertyRef(row) ??
      ({
        sheetId: this.sheetId,
        objectKey: row.objectKey,
        path: row.path,
      } as const)
    const existing = row.trackId
      ? getTrack(this.timeline.document, {
          sheetId: this.sheetId,
          objectKey: row.objectKey,
          trackId: row.trackId,
        }).keyframes.find(
          (keyframe) => Math.abs(keyframe.position - time) < 1e-6,
        )
      : undefined
    let created: KeyframeAddress | undefined
    try {
      this.timeline.editor.transaction(
        (transaction) => {
          if (existing) {
            transaction.removeKeyframeAt(target, time)
          } else {
            created = transaction.addKeyframeAt(target, {position: time})
          }
        },
        {
          label: existing
            ? `Quitar keyframe de ${row.label}`
            : `Añadir keyframe a ${row.label}`,
        },
      )
    } catch (error) {
      console.warn(error)
      return
    }
    this.timeline.getPlayer(this.sheetId).seek(time)
    this.selectKeyframe(created)
  }

  private readonly startKeyframeDrag = (
    event: PointerEvent,
    address: KeyframeAddress,
  ): void => {
    if (
      this.spacePressed ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey
    ) return
    event.preventDefault()
    event.stopPropagation()
    const player = this.timeline.getPlayer(this.sheetId)
    player.pause()
    if (!this.keyframeSelection.has(address)) {
      this.selectKeyframe(address, 'replace', false)
    } else {
      this.makeKeyframePrimary(address)
    }
    const draggedKeyframe = getTrack(this.timeline.document, address).keyframes.find(
      (keyframe) => keyframe.id === address.keyframeId,
    )
    if (!draggedKeyframe) return
    player.seek(draggedKeyframe.position)

    const snapshots: KeyframeDragSnapshot[] = []
    for (const selectedAddress of this.keyframeSelection.values) {
      const keyframe = findKeyframe(this.timeline.document, selectedAddress)
      if (keyframe) {
        snapshots.push({address: selectedAddress, position: keyframe.position})
      }
    }
    if (snapshots.length === 0) return

    this.cancelPointerInteraction?.()
    const gesture = this.timeline.store.beginGesture(
      snapshots.length === 1
        ? 'Mover keyframe'
        : `Mover ${snapshots.length} keyframes`,
    )
    this.activeGesture = gesture
    const startClientX = event.clientX
    let moved = false
    let lastDelta: number | undefined

    const move = (moveEvent: PointerEvent): void => {
      if (Math.abs(moveEvent.clientX - startClientX) > 2) moved = true
      const requestedPosition = this.timeFromClientX(moveEvent.clientX, true)
      const delta = this.constrainKeyframeSelectionDelta(
        snapshots,
        requestedPosition - draggedKeyframe.position,
      )
      if (lastDelta === delta) return
      lastDelta = delta
      gesture.update((transaction) => {
        for (const snapshot of snapshots) {
          transaction.updateKeyframe(snapshot.address, {
            position: Number((snapshot.position + delta).toFixed(6)),
          })
        }
      })
      player.seek(Number((draggedKeyframe.position + delta).toFixed(6)))
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
      if (!moved) this.selectKeyframe(address)
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

  private constrainKeyframeSelectionDelta(
    snapshots: readonly KeyframeDragSnapshot[],
    requestedDelta: number,
  ): number {
    if (snapshots.length === 0 || Math.abs(requestedDelta) < 1e-9) return 0
    const duration = this.timeline.getDuration(this.sheetId)
    const frameDuration = 1 / this.timeline.getFps(this.sheetId)
    let minimumDelta = -Math.min(...snapshots.map(({position}) => position))
    let maximumDelta =
      duration - Math.max(...snapshots.map(({position}) => position))
    const selectedKeys = new Set(
      snapshots.map(({address}) => keyframeAddressKey(address)),
    )

    for (const snapshot of snapshots) {
      const track = getTrack(this.timeline.document, snapshot.address)
      for (const candidate of track.keyframes) {
        const candidateAddress: KeyframeAddress = {
          ...snapshot.address,
          keyframeId: candidate.id,
        }
        if (selectedKeys.has(keyframeAddressKey(candidateAddress))) continue
        if (candidate.position > snapshot.position && requestedDelta > 0) {
          maximumDelta = Math.min(
            maximumDelta,
            Math.max(
              0,
              candidate.position - snapshot.position - frameDuration,
            ),
          )
        } else if (
          candidate.position < snapshot.position &&
          requestedDelta < 0
        ) {
          minimumDelta = Math.max(
            minimumDelta,
            Math.min(
              0,
              candidate.position - snapshot.position + frameDuration,
            ),
          )
        }
      }
    }

    return Number(
      Math.max(minimumDelta, Math.min(maximumDelta, requestedDelta)).toFixed(6),
    )
  }

  private readonly startPlayheadDrag = (event: PointerEvent): void => {
    if (this.spacePressed || event.button !== 0) return
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

  private syncViewportMetrics(): boolean {
    if (!this.timelineScroll) return false
    return this.viewport.setMetrics(
      this.timeline.getDuration(this.sheetId),
      this.timeline.getFps(this.sheetId),
      Math.max(1, this.timelineScroll.clientWidth),
    )
  }

  private readonly onViewportChange = (change: TimelineViewportChange): void => {
    this.render()
    this.emitViewportChange(change.reason)
  }

  private emitViewportChange(reason: TimelineViewportChangeReason): void {
    if (!this.timelineScroll) return
    const snapshot = this.viewport.snapshot
    this.events.emit('viewport:change', {
      scrollLeft: this.timelineScroll.scrollLeft,
      scrollTop: this.timelineScroll.scrollTop,
      visibleRange: snapshot.visibleRange,
      zoom: snapshot.zoom,
      reason,
    })
  }

  private syncTreeScroll(): void {
    if (!this.timelineScroll || !this.treeRows) return
    this.treeRows.scrollTop = Math.max(0, this.timelineScroll.scrollTop - rulerHeight)
  }

  private readonly onTimelineWheel = (event: WheelEvent): void => {
    if (!this.timelineScroll) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const rect = this.timelineScroll.getBoundingClientRect()
      const anchor = viewportXToTime(
        event.clientX - rect.left,
        this.viewport.snapshot,
      )
      const factor = Math.max(
        0.1,
        Math.min(10, Math.exp(-normalizeWheelDelta(event.deltaY, event) * 0.002)),
      )
      this.viewport.zoomAt(anchor, factor)
      return
    }

    const horizontalDelta = normalizeWheelDelta(
      event.shiftKey ? event.deltaY : event.deltaX,
      event,
    )
    if (Math.abs(horizontalDelta) < 1e-6) return
    event.preventDefault()
    const snapshot = this.viewport.snapshot
    const deltaTime =
      (horizontalDelta / snapshot.width) *
      (snapshot.visibleEnd - snapshot.visibleStart)
    this.viewport.panBy(deltaTime)
  }

  private readonly onSurfaceClick = (event: MouseEvent): void => {
    if (event.button !== 0 || this.spacePressed || !this.selected) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (
      target.closest(
        '.k411-timeline-keyframe, .k411-timeline-playhead, .k411-timeline-playhead-handle, .k411-timeline-ruler',
      )
    ) {
      return
    }
    this.clearKeyframeSelectionFromSurface()
  }

  private readonly startPanDrag = (event: PointerEvent): void => {
    const isMiddleButton = event.button === 1
    const isSpaceDrag = event.button === 0 && this.spacePressed
    if (!isMiddleButton && !isSpaceDrag) return
    event.preventDefault()
    event.stopPropagation()
    this.cancelPointerInteraction?.()
    this.root?.focus({preventScroll: true})

    const initial = this.viewport.snapshot
    const startX = event.clientX
    const span = initial.visibleEnd - initial.visibleStart
    this.root?.classList.add('k411-timeline-root--panning')

    const move = (moveEvent: PointerEvent): void => {
      const deltaTime = -((moveEvent.clientX - startX) / initial.width) * span
      this.viewport.setVisibleRange(
        initial.visibleStart + deltaTime,
        initial.visibleEnd + deltaTime,
        'pan',
      )
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      this.root?.classList.remove('k411-timeline-root--panning')
      if (this.cancelPointerInteraction === cancel) {
        this.cancelPointerInteraction = undefined
      }
    }
    const finish = (): void => cleanup()
    const cancel = (): void => {
      cleanup()
      if (initial.mode === 'fit') this.viewport.fitToSequence()
      else {
        this.viewport.setVisibleRange(
          initial.visibleStart,
          initial.visibleEnd,
          'pan',
        )
      }
    }
    this.cancelPointerInteraction = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, {once: true})
    window.addEventListener('pointercancel', cancel, {once: true})
  }

  private readonly onTimelineScroll = (): void => {
    if (!this.timelineScroll || !this.treeRows) return
    this.syncTreeScroll()
    const snapshot = this.viewport.snapshot
    const span = snapshot.visibleEnd - snapshot.visibleStart
    const visibleStart = scrollLeftToVisibleStart(
      this.timelineScroll.scrollLeft,
      snapshot,
    )
    const viewportChanged =
      Math.abs(visibleStart - snapshot.visibleStart) > 1e-6
        ? this.viewport.setVisibleRange(
            visibleStart,
            visibleStart + span,
            'scroll',
          )
        : false
    const verticalChanged = this.timelineScroll.scrollTop !== this.lastScrollTop
    this.lastScrollTop = this.timelineScroll.scrollTop
    if (!viewportChanged && verticalChanged) this.emitViewportChange('scroll')
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isFormControl(event.target)) return
    if (event.code === 'Space') {
      event.preventDefault()
      this.spacePressed = true
      this.root?.classList.add('k411-timeline-root--pan-ready')
      return
    }
    if (event.key === 'Escape') {
      this.cancelActiveGesture()
      return
    }
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      this.viewport.fitToSequence()
      return
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      this.keyframeSelection.size > 0
    ) {
      event.preventDefault()
      const selected = [...this.keyframeSelection.values]
      this.timeline.editor.transaction((transaction) => {
        for (const address of selected) transaction.removeKeyframe(address)
      }, {
        label: selected.length === 1
          ? 'Eliminar keyframe'
          : `Eliminar ${selected.length} keyframes`,
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

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this.spacePressed = false
    this.root?.classList.remove('k411-timeline-root--pan-ready')
  }

  private cancelActiveGesture(): void {
    if (this.cancelPointerInteraction) this.cancelPointerInteraction()
    else if (this.activeGesture?.active) this.activeGesture.cancel()
    this.cancelPointerInteraction = undefined
    this.activeGesture = undefined
  }

  private timeFromClientX(clientX: number, snap: boolean): number {
    if (!this.timelineScroll) return 0
    const rect = this.timelineScroll.getBoundingClientRect()
    const time = viewportXToTime(clientX - rect.left, this.viewport.snapshot)
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

function formatDuration(value: number): string {
  return value.toFixed(3)
}

function formatKeyframeTime(value: number): string {
  return value.toFixed(3)
}

function formatUnknownNumber(value: SerializableValue | undefined): string {
  return typeof value === 'number' ? formatNumber(value) : '0'
}

function fullValueLabel(value: SerializableValue | undefined): string {
  if (typeof value === 'undefined') return 'sin valor'
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'sin valor')
}

function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function normalizeWheelDelta(delta: number, event: WheelEvent): number {
  if (event.deltaMode === 1) return delta * 16
  if (event.deltaMode === 2) {
    return delta * Math.max(1, (event.currentTarget as HTMLElement | null)?.clientWidth ?? 800)
  }
  return delta
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

function isPrimitivePropertyRow(row: TimelineRow): boolean {
  return (
    row.path.length > 0 &&
    (row.kind === 'track' || row.kind === 'static')
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

function findKeyframe(document: TimelineDocument, address: KeyframeAddress) {
  return document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
    address.objectKey
  ]?.trackData[address.trackId]?.keyframes.find(
    (keyframe) => keyframe.id === address.keyframeId,
  )
}

type KeyframeEasingDisplay = EasingPreset | 'imported' | 'none'

function getKeyframeEasing(
  document: TimelineDocument,
  address: KeyframeAddress,
): KeyframeEasingDisplay {
  const track = document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
    address.objectKey
  ]?.trackData[address.trackId]
  const index = track?.keyframes.findIndex(
    (keyframe) => keyframe.id === address.keyframeId,
  ) ?? -1
  if (!track || index < 0 || index >= track.keyframes.length - 1) return 'none'

  const left = track.keyframes[index]
  const right = track.keyframes[index + 1]
  if (!left.connectedRight || left.type === 'hold') return 'hold'
  const points = [
    left.handles[2],
    left.handles[3],
    right.handles[0],
    right.handles[1],
  ]
  for (const [preset, expected] of Object.entries(easingPresetPoints)) {
    if (points.every((point, pointIndex) => Math.abs(point - expected[pointIndex]) < 1e-6)) {
      return preset as Exclude<EasingPreset, 'hold'>
    }
  }
  return 'imported'
}

function isEasingPreset(value: string): value is EasingPreset {
  return (
    value === 'hold' ||
    Object.prototype.hasOwnProperty.call(easingPresetPoints, value)
  )
}
