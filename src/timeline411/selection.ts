import type {KeyframeAddress} from './model'

export interface TimelineKeyframeSelectionSnapshot {
  /** Keyframe principal; se conserva como alias compatible con la selección simple. */
  readonly selection?: KeyframeAddress
  /** Keyframes seleccionados en orden de selección. */
  readonly selections: readonly KeyframeAddress[]
}

/**
 * Estado de selección independiente de cualquier renderer.
 * HTML y un futuro renderer WebGL pueden aplicar las mismas reglas de selección.
 */
export class TimelineKeyframeSelection {
  private addresses: KeyframeAddress[] = []
  private primaryAddress?: KeyframeAddress

  get size(): number {
    return this.addresses.length
  }

  get primary(): KeyframeAddress | undefined {
    return this.primaryAddress ? {...this.primaryAddress} : undefined
  }

  get values(): readonly KeyframeAddress[] {
    return this.addresses.map((address) => ({...address}))
  }

  get snapshot(): TimelineKeyframeSelectionSnapshot {
    return {
      selection: this.primaryAddress ? {...this.primaryAddress} : undefined,
      selections: this.addresses.map((address) => ({...address})),
    }
  }

  has(address: KeyframeAddress): boolean {
    return this.addresses.some((candidate) =>
      sameKeyframeAddress(candidate, address),
    )
  }

  replace(address?: KeyframeAddress): boolean {
    if (!address) return this.clear()
    if (
      this.addresses.length === 1 &&
      sameKeyframeAddress(this.addresses[0], address) &&
      sameKeyframeAddress(this.primaryAddress, address)
    ) {
      return false
    }
    const stored = {...address}
    this.addresses = [stored]
    this.primaryAddress = stored
    return true
  }

  toggle(address: KeyframeAddress): boolean {
    const index = this.addresses.findIndex((candidate) =>
      sameKeyframeAddress(candidate, address),
    )
    if (index === -1) {
      const stored = {...address}
      this.addresses = [...this.addresses, stored]
      this.primaryAddress = stored
      return true
    }

    this.addresses = this.addresses.filter((_, candidateIndex) =>
      candidateIndex !== index,
    )
    if (sameKeyframeAddress(this.primaryAddress, address)) {
      this.primaryAddress = this.addresses[this.addresses.length - 1]
    }
    return true
  }

  makePrimary(address: KeyframeAddress): boolean {
    const selected = this.addresses.find((candidate) =>
      sameKeyframeAddress(candidate, address),
    )
    if (!selected || sameKeyframeAddress(this.primaryAddress, selected)) {
      return false
    }
    this.primaryAddress = selected
    return true
  }

  retain(predicate: (address: KeyframeAddress) => boolean): boolean {
    const retained = this.addresses.filter((address) =>
      predicate({...address}),
    )
    if (retained.length === this.addresses.length) return false
    this.addresses = retained
    if (
      !this.primaryAddress ||
      !retained.some((address) =>
        sameKeyframeAddress(address, this.primaryAddress),
      )
    ) {
      this.primaryAddress = retained[retained.length - 1]
    }
    return true
  }

  clear(): boolean {
    if (this.addresses.length === 0) return false
    this.addresses = []
    this.primaryAddress = undefined
    return true
  }
}

export function keyframeAddressKey(address: KeyframeAddress): string {
  return JSON.stringify([
    address.sheetId,
    address.objectKey,
    address.trackId,
    address.keyframeId,
  ])
}

export function sameKeyframeAddress(
  left: KeyframeAddress | undefined,
  right: KeyframeAddress | undefined,
): boolean {
  if (!left || !right) return false
  return (
    left.sheetId === right.sheetId &&
    left.objectKey === right.objectKey &&
    left.trackId === right.trackId &&
    left.keyframeId === right.keyframeId
  )
}
