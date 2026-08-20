import {describe, expect, it} from 'vitest'
import {
  getMinimumVisibleSpan,
  getViewportScrollLeft,
  getViewportVirtualWidth,
  scrollLeftToVisibleStart,
  timeToViewportSurfaceX,
  timeToViewportX,
  TimelineViewport,
  viewportXToTime,
} from '../src/timeline411/viewport'

describe('viewport temporal', () => {
  it('comienza encajando la secuencia completa', () => {
    const viewport = new TimelineViewport({duration: 10, fps: 30, width: 800})

    expect(viewport.snapshot).toMatchObject({
      visibleStart: 0,
      visibleEnd: 10,
      visibleRange: [0, 10],
      zoom: 1,
      mode: 'fit',
    })
  })

  it('mantiene el tiempo bajo el cursor durante el zoom focal', () => {
    const viewport = new TimelineViewport({duration: 10, fps: 30, width: 1000})
    const anchor = 2.5
    const xBefore = timeToViewportX(anchor, viewport.snapshot)

    viewport.zoomAt(anchor, 2)

    expect(viewport.snapshot.visibleRange).toEqual([1.25, 6.25])
    expect(timeToViewportX(anchor, viewport.snapshot)).toBeCloseTo(xBefore)
    expect(viewportXToTime(xBefore, viewport.snapshot)).toBeCloseTo(anchor)
    expect(viewport.snapshot.mode).toBe('manual')
  })

  it('limita zoom y pan al rango temporal válido', () => {
    const viewport = new TimelineViewport({duration: 10, fps: 30, width: 800})
    viewport.zoomAt(5, 1_000_000)
    expect(viewport.snapshot.visibleEnd - viewport.snapshot.visibleStart).toBeCloseTo(
      getMinimumVisibleSpan(10, 30),
    )

    viewport.setVisibleRange(2.5, 7.5)
    viewport.panBy(-100)
    expect(viewport.snapshot.visibleRange).toEqual([0, 5])
    viewport.panBy(100)
    expect(viewport.snapshot.visibleRange).toEqual([5, 10])
  })

  it('conserva el rango manual en resize y normaliza cambios de duración', () => {
    const viewport = new TimelineViewport({duration: 10, fps: 30, width: 500})
    viewport.setVisibleRange(2, 6)
    viewport.setMetrics(10, 30, 900)
    expect(viewport.snapshot.visibleRange).toEqual([2, 6])

    viewport.setMetrics(5, 30, 900)
    expect(viewport.snapshot.visibleRange).toEqual([1, 5])
    viewport.fitToSequence()
    viewport.setMetrics(8, 30, 700)
    expect(viewport.snapshot.visibleRange).toEqual([0, 8])
  })

  it('sincroniza rango visible, superficie virtual y scrollbar', () => {
    const viewport = new TimelineViewport({duration: 10, fps: 30, width: 400})
    viewport.setVisibleRange(2, 6)
    const snapshot = viewport.snapshot

    expect(getViewportVirtualWidth(snapshot)).toBe(1000)
    expect(getViewportScrollLeft(snapshot)).toBe(200)
    expect(scrollLeftToVisibleStart(200, snapshot)).toBe(2)
    expect(timeToViewportSurfaceX(2, snapshot)).toBe(200)
    expect(timeToViewportSurfaceX(6, snapshot)).toBe(600)
  })
})
