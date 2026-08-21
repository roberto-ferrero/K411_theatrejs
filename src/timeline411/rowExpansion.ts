import type {TimelineRow} from './projection'

export interface TimelineRowExpansionSnapshot {
  readonly collapsedRowIds: readonly string[]
}

export interface TimelineRowExpansionReader {
  isCollapsed(rowId: string): boolean
}

/** Estado de filas plegadas independiente de HTML, SVG o WebGL. */
export class TimelineRowExpansionState implements TimelineRowExpansionReader {
  private collapsed = new Set<string>()

  get snapshot(): TimelineRowExpansionSnapshot {
    return {collapsedRowIds: [...this.collapsed]}
  }

  isCollapsed(rowId: string): boolean {
    return this.collapsed.has(rowId)
  }

  collapse(rowId: string): boolean {
    if (this.collapsed.has(rowId)) return false
    this.collapsed.add(rowId)
    return true
  }

  expand(rowId: string): boolean {
    return this.collapsed.delete(rowId)
  }

  toggle(rowId: string): boolean {
    if (this.collapsed.has(rowId)) {
      this.collapsed.delete(rowId)
      return false
    }
    this.collapsed.add(rowId)
    return true
  }

  retain(rowIds: Iterable<string>): boolean {
    const valid = new Set(rowIds)
    const retained = new Set(
      [...this.collapsed].filter((rowId) => valid.has(rowId)),
    )
    if (
      retained.size === this.collapsed.size &&
      [...retained].every((rowId) => this.collapsed.has(rowId))
    ) return false
    this.collapsed = retained
    return true
  }

  clear(): boolean {
    if (this.collapsed.size === 0) return false
    this.collapsed.clear()
    return true
  }
}

export function isTimelineRowCollapsible(row: TimelineRow): boolean {
  return row.hasChildren && (row.kind === 'object' || row.kind === 'group')
}

export function filterVisibleTimelineRows(
  rows: readonly TimelineRow[],
  expansion: TimelineRowExpansionReader,
): readonly TimelineRow[] {
  const visible: TimelineRow[] = []
  let collapsedDepth: number | undefined

  for (const row of rows) {
    if (typeof collapsedDepth !== 'undefined') {
      if (row.depth > collapsedDepth) continue
      collapsedDepth = undefined
    }
    visible.push(row)
    if (isTimelineRowCollapsible(row) && expansion.isCollapsed(row.id)) {
      collapsedDepth = row.depth
    }
  }
  return visible
}
