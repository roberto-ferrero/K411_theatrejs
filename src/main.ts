import './style.css'
import {createThreeScene} from './scene'
import {connectTheatreTimeline} from './theatreTimeline'
import {connectTimeline411Html} from './timeline411Bootstrap'

type TimelineMode = 'theatre' | 'html'

interface Workspace {
  readonly root: HTMLElement
  readonly sceneContainer: HTMLElement
  readonly timelineContainer?: HTMLElement
}

const app = getRequiredAppElement()

const selector = createTimelineSelector()
app.appendChild(selector)

function getRequiredAppElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#app')
  if (!element) throw new Error('No se ha encontrado el elemento #app')
  return element
}

function createTimelineSelector(): HTMLElement {
  const overlay = document.createElement('main')
  overlay.className = 'timeline-selector'

  const panel = document.createElement('section')
  panel.className = 'timeline-selector__panel'
  panel.setAttribute('aria-labelledby', 'timeline-selector-title')

  const eyebrow = document.createElement('p')
  eyebrow.className = 'timeline-selector__eyebrow'
  eyebrow.textContent = 'K411 · TIMELINE LAB'

  const title = document.createElement('h1')
  title.id = 'timeline-selector-title'
  title.textContent = 'Seleccionar tipo de timeline:'

  const options = document.createElement('div')
  options.className = 'timeline-selector__options'

  const theatreButton = createOptionButton(
    '1',
    'Timeline Theatre.js',
    'Editor actual conectado a la animación del torus.',
  )
  const htmlButton = createOptionButton(
    '2',
    'Timeline 411 HTML',
    'Editor HTML/SVG conectado a la animación del torus.',
  )
  const webglButton = createOptionButton(
    '3',
    'Timeline 411 WebGL',
    'Próximamente',
  )
  webglButton.disabled = true
  webglButton.setAttribute('aria-disabled', 'true')

  const status = document.createElement('p')
  status.className = 'timeline-selector__status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const availableButtons = [theatreButton, htmlButton]

  const selectMode = async (mode: TimelineMode): Promise<void> => {
    for (const button of availableButtons) button.disabled = true
    status.classList.remove('timeline-selector__status--error')
    status.textContent = 'Iniciando…'

    try {
      if (mode === 'theatre') await startTheatreMode()
      else startHtmlMode()

      overlay.remove()
    } catch (error) {
      for (const button of availableButtons) button.disabled = false
      status.classList.add('timeline-selector__status--error')
      status.textContent =
        error instanceof Error
          ? `No se pudo iniciar: ${error.message}`
          : 'No se pudo iniciar el timeline.'
    }
  }

  theatreButton.addEventListener('click', () => {
    void selectMode('theatre')
  })
  htmlButton.addEventListener('click', () => {
    void selectMode('html')
  })

  options.append(theatreButton, htmlButton, webglButton)
  panel.append(eyebrow, title, options, status)
  overlay.appendChild(panel)

  return overlay
}

function createOptionButton(
  index: string,
  label: string,
  description: string,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'timeline-option'
  button.type = 'button'

  const number = document.createElement('span')
  number.className = 'timeline-option__number'
  number.textContent = index
  number.setAttribute('aria-hidden', 'true')

  const copy = document.createElement('span')
  copy.className = 'timeline-option__copy'

  const name = document.createElement('span')
  name.className = 'timeline-option__name'
  name.textContent = `${index}: ${label}`

  const detail = document.createElement('span')
  detail.className = 'timeline-option__description'
  detail.textContent = description

  copy.append(name, detail)
  button.append(number, copy)

  return button
}

async function startTheatreMode(): Promise<void> {
  const workspace = createWorkspace(false)
  const threeScene = createThreeScene(workspace.sceneContainer)

  try {
    await connectTheatreTimeline(threeScene)
  } catch (error) {
    threeScene.dispose()
    workspace.root.remove()
    throw error
  }
}

function startHtmlMode(): void {
  const workspace = createWorkspace(true)
  const threeScene = createThreeScene(workspace.sceneContainer)
  const timelineContainer = workspace.timelineContainer

  if (!timelineContainer) {
    threeScene.dispose()
    workspace.root.remove()
    throw new Error('No se pudo crear el contenedor del timeline HTML')
  }

  timelineContainer.dataset.timeline = '411-html'
  timelineContainer.dataset.targetObject = threeScene.torusKnot.name
  connectTimeline411Html(threeScene, timelineContainer)
}

function createWorkspace(includeTimelineContainer: boolean): Workspace {
  const root = document.createElement('div')
  root.className = includeTimelineContainer
    ? 'workspace workspace--with-timeline'
    : 'workspace'

  const sceneContainer = document.createElement('div')
  sceneContainer.className = 'scene-container'
  sceneContainer.setAttribute('aria-label', 'Escena 3D')
  root.appendChild(sceneContainer)

  let timelineContainer: HTMLElement | undefined
  if (includeTimelineContainer) {
    timelineContainer = document.createElement('div')
    timelineContainer.id = 'timeline-411-html'
    timelineContainer.className = 'timeline-411-placeholder'
    timelineContainer.setAttribute(
      'aria-label',
      'Timeline 411 HTML',
    )
    root.appendChild(timelineContainer)
  }

  app.appendChild(root)
  return {root, sceneContainer, timelineContainer}
}
