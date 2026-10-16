// Spring presets the devignerui components import. Values are tuned by feel:
// layout glides, a pointer-follow that keeps up, a quick press and slow retract.

const spring = (stiffness: number, damping: number, mass = 1) =>
  ({ type: "spring", stiffness, damping, mass }) as const;

/** A value gliding to a new place (click, key, release). */
export const SPRING_LAYOUT = spring(420, 42);
/** Following the pointer while dragging. */
export const SPRING_MOUSE = spring(700, 48, 0.5);
/** Handle firming up when grabbed. */
export const SPRING_PRESS = spring(700, 32);
/** Handle relaxing when let go. */
export const SPRING_RETRACT = spring(260, 26);
/** Rolling digits trailing the value. */
export const SPRING_TRAVEL = spring(160, 24);
/** Small UI swaps (segmented pill, status text). */
export const SPRING_SWAP = spring(500, 38);

/** Dust drift: px per frame along/across, and twinkle phase per frame. */
export const DRIFT_DUST = { speed: 0.12, twinkle: 0.035 } as const;
