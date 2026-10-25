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
export interface Fingers { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean }
export function fingerStates(lm: Landmarks): Fingers {
  const none = { thumb: false, index: false, middle: false, ring: false, pinky: false };
  if (lm.length < 21) return none;
  const wrist = lm[WRIST]!;
  const out = FINGERS.map(([pip, tip]) => dist(wrist, lm[tip]!) > dist(wrist, lm[pip]!) * 1.15);
  // The thumb folds sideways across the palm, so compare it with the base of the index finger instead.
  const thumb = dist(lm[THUMB_TIP]!, lm[INDEX_MCP]!) > dist(lm[THUMB_IP]!, lm[INDEX_MCP]!) * 1.25;
  return { thumb, index: out[0]!, middle: out[1]!, ring: out[2]!, pinky: out[3]! };
}

/** How many fingers are held out (0 to 5). Uses distances rather than "is the tip above the knuckle", so it works when the hand is tilted. */
export function countFingers(lm: Landmarks): number {
  return Object.values(fingerStates(lm)).filter(Boolean).length;
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

/** The actions gestures can pick, in the order N fingers selects them. Typed-text actions are left out. */
export function gestureOptions<T extends { hotkey?: number; needsText?: boolean }>(legal: T[]): T[] {
  return legal.filter((l) => l.hotkey != null && !l.needsText).sort((a, b) => (a.hotkey ?? 0) - (b.hotkey ?? 0));
}

// ---------- task gestures: hand shapes that mean something in the safety task ----------

/** point = interact with what you face; phone = call for help; stop = keep people back; thumbs up = agree; fist = cancel. */
export type TaskPose = "none" | "point" | "phone" | "stop" | "thumbs_up" | "fist";

export function taskPoseOf(lm: Landmarks | null): TaskPose {
  if (!lm || lm.length < 21) return "none";
  const f = fingerStates(lm);
  const others = f.middle || f.ring || f.pinky;
  if (f.thumb && f.index && f.middle && f.ring && f.pinky) return "stop";
  if (f.thumb && f.pinky && !f.index && !f.middle && !f.ring) return "phone";
  if (f.index && !f.middle && !f.ring && !f.pinky) return "point";
  if (f.thumb && !f.index && !others && lm[THUMB_TIP]!.y < lm[WRIST]!.y - 0.05) return "thumbs_up";
  if (!f.thumb && !f.index && !others) return "fist";
  return "none";
}

export type TaskEvent = { type: "progress"; pose: TaskPose; value: number } | { type: "pose"; pose: TaskPose } | { type: "lost" };
export const HOLD_MS: Record<Exclude<TaskPose, "none">, number> = { point: 350, thumbs_up: 500, phone: 700, stop: 800, fist: 800 };

/** A pose counts only after it is held steady for its hold time, and the same pose can't fire again until the hand changes. */
export class TaskGestures {
  private pose: TaskPose = "none";
  private since = 0;
  private fired = false;
  private coolUntil = 0;

  feed(lm: Landmarks | null, now: number): TaskEvent[] {
    const out: TaskEvent[] = [];
    const p = taskPoseOf(lm);
    if (!lm) { if (this.pose !== "none") out.push({ type: "lost" }); this.pose = "none"; this.fired = false; return out; }
    if (p !== this.pose) {
      if (this.pose !== "none" && !this.fired) out.push({ type: "progress", pose: this.pose, value: 0 });
      this.pose = p; this.since = now; this.fired = false;
    }
    if (p === "none" || this.fired || now < this.coolUntil) return out;
    const value = Math.min(1, (now - this.since) / HOLD_MS[p]);
    out.push({ type: "progress", pose: p, value });
    if (value >= 1) { this.fired = true; this.coolUntil = now + 1500; out.push({ type: "pose", pose: p }); }
    return out;
  }
}
