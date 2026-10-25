// Hand-gesture logic, kept free of the camera and of any library so it can be tested with plain numbers.
// A "frame" is the 21 hand landmarks MediaPipe reports (normalized 0..1, y grows downward) or null when no hand is seen.

export interface Pt { x: number; y: number; z?: number }
export type Landmarks = readonly Pt[];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// Landmark indices (MediaPipe hand model)
const WRIST = 0, THUMB_IP = 3, THUMB_TIP = 4, INDEX_MCP = 5;
const FINGERS: [pip: number, tip: number][] = [[6, 8], [10, 12], [14, 16], [18, 20]];

/**
 * How many fingers are held out (0 to 5). Uses distances rather than "is the tip above the knuckle", so it still works when the
 * hand is tilted or sideways.
 */
export function countFingers(lm: Landmarks): number {
  if (lm.length < 21) return 0;
  const wrist = lm[WRIST]!;
  let n = 0;
  for (const [pip, tip] of FINGERS) if (dist(wrist, lm[tip]!) > dist(wrist, lm[pip]!) * 1.15) n++;
  // The thumb folds sideways across the palm, so compare it with the base of the index finger instead.
  if (dist(lm[THUMB_TIP]!, lm[INDEX_MCP]!) > dist(lm[THUMB_IP]!, lm[INDEX_MCP]!) * 1.25) n++;
  return n;
}

export type Pose = "none" | "fist" | "count1" | "count2" | "count3" | "count4" | "palm";
export function poseOf(lm: Landmarks | null): Pose {
  if (!lm) return "none";
  const n = countFingers(lm);
  return n === 0 ? "fist" : n === 5 ? "palm" : (`count${n}` as Pose);
}

export type GestureEvent =
  | { type: "highlight"; index: number }
  | { type: "move"; delta: -1 | 1 }
  | { type: "progress"; intent: "confirm" | "cancel"; value: number }
  | { type: "confirm"; index: number }
  | { type: "cancel" }
  | { type: "lost" };

export interface GestureConfig {
  /** A pose must stay the same this long before it counts (stops flicker). */
  stableMs: number;
  /** An open palm or fist must be held this long to confirm or cancel. */
  holdMs: number;
  /** After confirming, wait this long (and see the hand change) before another confirm. */
  cooldownMs: number;
  /** Horizontal travel (fraction of the picture width) within `swipeWindowMs` that counts as a swipe. */
  swipeDistance: number;
  swipeWindowMs: number;
  /** The preview is mirrored like a mirror, so the user's right is on the right of the screen. */
  mirrored: boolean;
}

export const DEFAULT_GESTURES: GestureConfig = { stableMs: 250, holdMs: 800, cooldownMs: 1200, swipeDistance: 0.25, swipeWindowMs: 450, mirrored: true };

/**
 * Turns a stream of hand frames into a small set of intentions:
 *   1 to 4 fingers      highlight option 1 to 4
 *   swipe left / right  move the highlight
 *   open palm, held     confirm the highlighted option
 *   fist, held          cancel (clears the highlight)
 * It never confirms when nothing is highlighted, so a stray palm does nothing.
 */
export class GestureController {
  private pose: Pose = "none";
  private poseSince = 0;
  private lastStable: Pose = "none";
  private highlight = -1;
  private trail: { t: number; x: number }[] = [];
  private holdIntent: "confirm" | "cancel" | null = null;
  private holdStart = 0;
  private locked = false; // set after a confirm, cleared when the pose changes
  private cooldownUntil = 0;
  private swipeUntil = 0;

  constructor(private optionCount: () => number, private cfg: GestureConfig = DEFAULT_GESTURES) {}

  get current(): number { return this.highlight; }
  reset(): void { this.highlight = -1; this.holdIntent = null; this.trail = []; this.locked = false; this.pose = "none"; this.lastStable = "none"; }

  feed(lm: Landmarks | null, now: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    const pose = poseOf(lm);

    if (!lm) {
      if (this.pose !== "none") out.push({ type: "lost" });
      this.pose = "none"; this.poseSince = now; this.lastStable = "none"; this.trail = []; this.highlight = -1;
      this.stopHold(out);
      this.locked = false;
      return out;
    }

    if (pose !== this.pose) { this.pose = pose; this.poseSince = now; this.stopHold(out); }
    const stable = now - this.poseSince >= this.cfg.stableMs;
    const max = Math.max(0, this.optionCount());

    // Swipes: watch the wrist, mirrored so "right" means the user's right.
    const x = this.cfg.mirrored ? 1 - lm[0]!.x : lm[0]!.x;
    this.trail.push({ t: now, x });
    this.trail = this.trail.filter((p) => now - p.t <= this.cfg.swipeWindowMs);
    if (now >= this.swipeUntil && this.trail.length >= 3 && max > 0) {
      const dx = x - this.trail[0]!.x;
      if (Math.abs(dx) >= this.cfg.swipeDistance) {
        const delta = dx > 0 ? 1 : -1;
        this.highlight = this.highlight < 0 ? (delta > 0 ? 0 : max - 1) : Math.min(max - 1, Math.max(0, this.highlight + delta));
        this.swipeUntil = now + 600;
        this.trail = [];
        out.push({ type: "move", delta }, { type: "highlight", index: this.highlight });
        return out;
      }
    }

    if (!stable) return out;
    if (this.lastStable !== pose) {
      this.lastStable = pose;
      this.locked = false; // a changed pose re-arms confirm
      const m = /^count([1-4])$/.exec(pose);
      if (m && max > 0) {
        this.highlight = Math.min(max, Number(m[1])) - 1;
        out.push({ type: "highlight", index: this.highlight });
      }
    }

    // Hold an open palm to confirm, or a fist to cancel.
    const intent = pose === "palm" ? "confirm" : pose === "fist" ? "cancel" : null;
    if (!intent || this.locked || now < this.cooldownUntil || (intent === "confirm" && this.highlight < 0)) { this.stopHold(out); return out; }
    if (this.holdIntent !== intent) { this.holdIntent = intent; this.holdStart = now; }
    const value = Math.min(1, (now - this.holdStart) / this.cfg.holdMs);
    out.push({ type: "progress", intent, value });
    if (value >= 1) {
      this.holdIntent = null;
      this.locked = true;
      this.cooldownUntil = now + this.cfg.cooldownMs;
      if (intent === "confirm") { out.push({ type: "confirm", index: this.highlight }); this.highlight = -1; }
      else { out.push({ type: "cancel" }); this.highlight = -1; }
    }
    return out;
  }

  private stopHold(out: GestureEvent[]): void {
    if (this.holdIntent) { out.push({ type: "progress", intent: this.holdIntent, value: 0 }); this.holdIntent = null; }
  }
}
