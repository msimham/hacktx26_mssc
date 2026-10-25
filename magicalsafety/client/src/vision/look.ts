// Where the player is "looking": the hand position from the camera when it's on, else the mouse. The scene leans toward it.
export const look = { x: 0, y: 0, at: 0 };
export function setLook(x: number, y: number, now: number): void {
  look.x = Math.max(-1, Math.min(1, x)); look.y = Math.max(-1, Math.min(1, y)); look.at = now;
}
/** Move `cur` a fraction of the way to `target` (smoothing, so the picture glides instead of jittering). */
export const ease = (cur: number, target: number, k = 0.08): number => cur + (target - cur) * k;

/** Saying a person's name leans the scene toward them for a few seconds (overrides hand and pointer). */
export const focusLook = { x: 0, until: 0 };
export function focusOn(x: number, now: number, ms = 4000): void { focusLook.x = Math.max(-1, Math.min(1, x)); focusLook.until = now + ms; }
