import type {CubicBezierHandles} from './model'

export interface BezierCurveEditorOptions {
  readonly onChange: (handles: CubicBezierHandles) => void
  readonly onApply: () => void
  readonly onCancel: () => void
}

const svgNamespace = 'http://www.w3.org/2000/svg'
const graphWidth = 240
const graphHeight = 170
const graphPaddingX = 22
const graphPaddingY = 14
const plotWidth = graphWidth - graphPaddingX * 2
const plotHeight = graphHeight - graphPaddingY * 2
const easeInOutHandles: CubicBezierHandles = [0.42, 0, 0.58, 1]

export class BezierCurveEditor {
  readonly element: HTMLElement
  private readonly graph: SVGSVGElement
  private readonly rangeBand: SVGRectElement
  private readonly zeroLine: SVGLineElement
  private readonly oneLine: SVGLineElement
  private readonly incomingGuide: SVGLineElement
  private readonly outgoingGuide: SVGLineElement
  private readonly curve: SVGPathElement
  private readonly incomingControl: SVGCircleElement
  private readonly outgoingControl: SVGCircleElement
  private readonly inputs: readonly HTMLInputElement[]
  private handlesValue: [number, number, number, number] = [...easeInOutHandles]
  private yMin = -1
  private yMax = 2

  constructor(private readonly options: BezierCurveEditorOptions) {
    const panel = document.createElement('aside')
    panel.className = 'k411-bezier-editor'
    panel.hidden = true
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Editor de curva Bezier')
    panel.addEventListener('click', (event) => event.stopPropagation())
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      this.options.onCancel()
    })

    const header = document.createElement('header')
    header.className = 'k411-bezier-editor__header'
    const title = document.createElement('strong')
    title.textContent = 'Curva personalizada'
    const closeButton = createButton('×', 'Cerrar sin aplicar')
    closeButton.classList.add('k411-bezier-editor__close')
    closeButton.addEventListener('click', this.options.onCancel)
    header.append(title, closeButton)

    const graph = document.createElementNS(svgNamespace, 'svg')
    graph.classList.add('k411-bezier-editor__graph')
    graph.dataset.bezierGraph = ''
    graph.setAttribute('viewBox', `0 0 ${graphWidth} ${graphHeight}`)
    graph.setAttribute('aria-label', 'Curva cúbica con dos controles arrastrables')
    graph.setAttribute('role', 'img')
    this.graph = graph

    const background = createSvgElement('rect')
    background.classList.add('k411-bezier-editor__background')
    background.setAttribute('x', String(graphPaddingX))
    background.setAttribute('y', String(graphPaddingY))
    background.setAttribute('width', String(plotWidth))
    background.setAttribute('height', String(plotHeight))

    this.rangeBand = createSvgElement('rect')
    this.rangeBand.classList.add('k411-bezier-editor__range')
    this.rangeBand.setAttribute('x', String(graphPaddingX))
    this.rangeBand.setAttribute('width', String(plotWidth))

    this.zeroLine = createSvgElement('line')
    this.zeroLine.classList.add('k411-bezier-editor__axis')
    this.oneLine = createSvgElement('line')
    this.oneLine.classList.add('k411-bezier-editor__axis')
    for (const line of [this.zeroLine, this.oneLine]) {
      line.setAttribute('x1', String(graphPaddingX))
      line.setAttribute('x2', String(graphPaddingX + plotWidth))
    }

    this.incomingGuide = createSvgElement('line')
    this.incomingGuide.classList.add('k411-bezier-editor__guide')
    this.outgoingGuide = createSvgElement('line')
    this.outgoingGuide.classList.add('k411-bezier-editor__guide')
    this.curve = createSvgElement('path')
    this.curve.classList.add('k411-bezier-editor__curve')
    this.incomingControl = this.createControl(0, 'Control de salida P1')
    this.outgoingControl = this.createControl(1, 'Control de entrada P2')

    graph.append(
      background,
      this.rangeBand,
      this.zeroLine,
      this.oneLine,
      this.incomingGuide,
      this.outgoingGuide,
      this.curve,
      createEndpoint(),
      createEndpoint(),
      this.incomingControl,
      this.outgoingControl,
    )

    const fields = document.createElement('div')
    fields.className = 'k411-bezier-editor__fields'
    this.inputs = (['x1', 'y1', 'x2', 'y2'] as const).map((name, index) => {
      const label = document.createElement('label')
      label.textContent = name
      const input = document.createElement('input')
      input.type = 'number'
      input.step = '0.001'
      input.inputMode = 'decimal'
      input.dataset.bezierValue = name
      input.setAttribute('aria-label', `Coordenada ${name}`)
      if (index === 0 || index === 2) {
        input.min = '0'
        input.max = '1'
      }
      input.addEventListener('input', () => this.readInputs())
      label.appendChild(input)
      fields.appendChild(label)
      return input
    })

    const hint = document.createElement('p')
    hint.className = 'k411-bezier-editor__hint'
    hint.textContent = 'X controla el tiempo (0–1). Y admite valores negativos.'

    const footer = document.createElement('footer')
    footer.className = 'k411-bezier-editor__footer'
    const resetButton = createButton('Ease In Out', 'Restablecer a Ease In Out')
    resetButton.dataset.bezierReset = ''
    resetButton.addEventListener('click', () => {
      this.setHandles(easeInOutHandles)
      this.options.onChange(this.handles)
    })
    const cancelButton = createButton('Cancelar', 'Cancelar edición de curva')
    cancelButton.dataset.bezierCancel = ''
    cancelButton.addEventListener('click', this.options.onCancel)
    const applyButton = createButton('Aplicar', 'Aplicar curva')
    applyButton.dataset.bezierApply = ''
    applyButton.classList.add('k411-bezier-editor__apply')
    applyButton.addEventListener('click', this.options.onApply)
    footer.append(resetButton, cancelButton, applyButton)

    panel.append(header, graph, fields, hint, footer)
    this.element = panel
    this.render()
  }

  get handles(): CubicBezierHandles {
    return [...this.handlesValue]
  }

  get open(): boolean {
    return !this.element.hidden
  }

  show(handles: CubicBezierHandles): void {
    this.setHandles(handles)
    this.element.hidden = false
    this.inputs[0].focus({preventScroll: true})
  }

  hide(): void {
    this.element.hidden = true
  }

  private setHandles(handles: CubicBezierHandles): void {
    this.handlesValue = [...handles]
    this.render()
  }

  private readInputs(): void {
    const values = this.inputs.map((input) => Number(input.value))
    const valid = values.every(Number.isFinite) &&
      values[0] >= 0 && values[0] <= 1 &&
      values[2] >= 0 && values[2] <= 1
    for (const [index, input] of this.inputs.entries()) {
      const invalidX = (index === 0 || index === 2) &&
        (values[index] < 0 || values[index] > 1)
      input.setCustomValidity(
        !Number.isFinite(values[index])
          ? 'Introduce un número finito'
          : invalidX
            ? 'X debe estar entre 0 y 1'
            : '',
      )
    }
    if (!valid) return
    this.handlesValue = values as [number, number, number, number]
    this.render(false)
    this.options.onChange(this.handles)
  }

  private createControl(index: 0 | 1, label: string): SVGCircleElement {
    const control = createSvgElement('circle')
    control.classList.add('k411-bezier-editor__control')
    control.dataset.bezierHandle = String(index + 1)
    control.setAttribute('r', '6')
    control.setAttribute('tabindex', '0')
    control.setAttribute('role', 'slider')
    control.setAttribute('aria-label', label)
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const move = (moveEvent: PointerEvent): void => {
        this.updateControlFromPointer(index, moveEvent)
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish, {once: true})
      window.addEventListener('pointercancel', finish, {once: true})
    })
    control.addEventListener('keydown', (event) => {
      const multiplier = event.shiftKey ? 10 : 1
      const xIndex = index * 2
      const yIndex = xIndex + 1
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        this.handlesValue[xIndex] = clamp(
          this.handlesValue[xIndex] + direction * 0.01 * multiplier,
          0,
          1,
        )
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? -1 : 1
        this.handlesValue[yIndex] += direction * 0.05 * multiplier
      } else {
        return
      }
      this.render()
      this.options.onChange(this.handles)
    })
    return control
  }

  private updateControlFromPointer(index: 0 | 1, event: PointerEvent): void {
    const rect = this.graph.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const graphX = ((event.clientX - rect.left) / rect.width) * graphWidth
    const graphY = ((event.clientY - rect.top) / rect.height) * graphHeight
    const x = clamp((graphX - graphPaddingX) / plotWidth, 0, 1)
    const y = this.yMax -
      ((graphY - graphPaddingY) / plotHeight) * (this.yMax - this.yMin)
    const offset = index * 2
    this.handlesValue[offset] = x
    this.handlesValue[offset + 1] = y
    this.render()
    this.options.onChange(this.handles)
  }

  private render(updateInputs = true): void {
    const [, y1, , y2] = this.handlesValue
    this.yMin = Math.min(-1, Math.floor(Math.min(y1, y2) * 2) / 2)
    this.yMax = Math.max(2, Math.ceil(Math.max(y1, y2) * 2) / 2)
    if (this.yMax - this.yMin < 1) this.yMax = this.yMin + 1

    const origin = this.toGraphPoint(0, 0)
    const end = this.toGraphPoint(1, 1)
    const first = this.toGraphPoint(this.handlesValue[0], y1)
    const second = this.toGraphPoint(this.handlesValue[2], y2)
    setLine(this.incomingGuide, origin, first)
    setLine(this.outgoingGuide, end, second)
    this.curve.setAttribute(
      'd',
      `M${origin.x} ${origin.y} C${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`,
    )
    setCircle(this.incomingControl, first)
    setCircle(this.outgoingControl, second)
    setCircle(this.graph.querySelectorAll<SVGCircleElement>(
      '.k411-bezier-editor__endpoint',
    )[0], origin)
    setCircle(this.graph.querySelectorAll<SVGCircleElement>(
      '.k411-bezier-editor__endpoint',
    )[1], end)
    const zeroY = this.toGraphPoint(0, 0).y
    const oneY = this.toGraphPoint(0, 1).y
    this.zeroLine.setAttribute('y1', String(zeroY))
    this.zeroLine.setAttribute('y2', String(zeroY))
    this.oneLine.setAttribute('y1', String(oneY))
    this.oneLine.setAttribute('y2', String(oneY))
    this.rangeBand.setAttribute('y', String(Math.min(zeroY, oneY)))
    this.rangeBand.setAttribute('height', String(Math.abs(zeroY - oneY)))

    this.incomingControl.setAttribute(
      'aria-valuetext',
      `${formatCoordinate(this.handlesValue[0])}, ${formatCoordinate(y1)}`,
    )
    this.outgoingControl.setAttribute(
      'aria-valuetext',
      `${formatCoordinate(this.handlesValue[2])}, ${formatCoordinate(y2)}`,
    )
    if (updateInputs) {
      this.inputs.forEach((input, index) => {
        input.value = formatCoordinate(this.handlesValue[index])
        input.setCustomValidity('')
      })
    }
  }

  private toGraphPoint(x: number, y: number): {x: number; y: number} {
    return {
      x: graphPaddingX + x * plotWidth,
      y: graphPaddingY + ((this.yMax - y) / (this.yMax - this.yMin)) * plotHeight,
    }
  }
}

function createButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.title = title
  return button
}

function createSvgElement<Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
): SVGElementTagNameMap[Tag] {
  return document.createElementNS(svgNamespace, tag)
}

function createEndpoint(): SVGCircleElement {
  const endpoint = createSvgElement('circle')
  endpoint.classList.add('k411-bezier-editor__endpoint')
  endpoint.setAttribute('r', '3.5')
  return endpoint
}

function setLine(
  line: SVGLineElement,
  start: {x: number; y: number},
  end: {x: number; y: number},
): void {
  line.setAttribute('x1', String(start.x))
  line.setAttribute('y1', String(start.y))
  line.setAttribute('x2', String(end.x))
  line.setAttribute('y2', String(end.y))
}

function setCircle(
  circle: SVGCircleElement | undefined,
  point: {x: number; y: number},
): void {
  if (!circle) return
  circle.setAttribute('cx', String(point.x))
  circle.setAttribute('cy', String(point.y))
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
