// The geometry of the first-person world, kept free of three.js so it can be tested with plain numbers.
// A room is a square HALF*2 metres across. +x is the player's right, -z is "forward" at yaw 0.

export const HALF = 11;
export const EYE = 1.65;
export const WALK_SPEED = 3.4;
export const TURN_SPEED = 1.9;
export const TALK_RANGE = 5.5;
export const EXIT_RANGE = 1.7;

export interface Pt { x: number; z: number }
export interface Spot extends Pt {
  id: string;
  kind: "target" | "exit" | "person";
  label: string;
  /** exit: the room it leads to. target: the thing in the world. person: the actor id. */
  ref: string;
}
export interface Keys { forward: boolean; back: boolean; left: boolean; right: boolean; turnLeft: boolean; turnRight: boolean }
export const NO_KEYS: Keys = { forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const LIMIT = HALF - 0.6;

/** A hotspot's place in the 2D art (percent of width and height) becomes a place on the floor. Up in the art is farther away. */
export function floorPos(xPct: number, yPct: number): Pt {
  return { x: clamp(((xPct - 50) / 50) * (HALF - 1.5), -LIMIT, LIMIT), z: clamp(((yPct - 50) / 50) * (HALF - 1.5), -LIMIT, LIMIT) };
}

/** Doorways stand in the wall nearest to where the exit sits in the art. */
export function doorPos(xPct: number, yPct: number): Pt {
  const p = floorPos(xPct, yPct);
  return Math.abs(p.x) >= Math.abs(p.z) ? { x: Math.sign(p.x || 1) * LIMIT, z: p.z } : { x: p.x, z: Math.sign(p.z || 1) * LIMIT };
}

/** Yaw that makes the camera look at a point (yaw 0 looks toward -z; positive yaw turns left). */
export function yawToward(from: Pt, to: Pt): number { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }

export const DEFAULT_SPAWN = { pos: { x: 0, z: HALF - 5 }, yaw: 0 };

/** Where to stand on arriving through `door`: a few metres in, looking at the room's middle. */
export function arrival(door: Pt): { pos: Pt; yaw: number } {
  const len = Math.hypot(door.x, door.z) || 1;
  const pos = { x: door.x - (door.x / len) * 3, z: door.z - (door.z / len) * 3 };
  return { pos, yaw: yawToward(pos, { x: 0, z: 0 }) };
}

/** One frame of walking. Forward follows where you look; the room's walls stop you. */
export function stepMove(state: { pos: Pt; yaw: number }, keys: Keys, dt: number): { pos: Pt; yaw: number } {
  let yaw = state.yaw + ((keys.turnLeft ? 1 : 0) - (keys.turnRight ? 1 : 0)) * TURN_SPEED * dt;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let dx = -Math.sin(yaw) * f + Math.cos(yaw) * s;
  let dz = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  const m = Math.hypot(dx, dz);
  if (m > 1) { dx /= m; dz /= m; }
  return { pos: { x: clamp(state.pos.x + dx * WALK_SPEED * dt, -LIMIT, LIMIT), z: clamp(state.pos.z + dz * WALK_SPEED * dt, -LIMIT, LIMIT) }, yaw };
}

/** The nearest thing you are facing (within about 30 degrees and TALK_RANGE), or null. People and things win over doorways. */
export function pickTarget(pos: Pt, yaw: number, spots: Spot[]): Spot | null {
  let best: { s: Spot; score: number } | null = null;
  for (const s of spots) {
    const dx = s.x - pos.x, dz = s.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > TALK_RANGE || dist < 0.01) continue;
    const bearing = Math.atan2(-dx, -dz);
    const off = Math.abs(Math.atan2(Math.sin(bearing - yaw), Math.cos(bearing - yaw)));
    if (off > 0.52) continue;
    const score = off * 3 + dist * 0.25 + (s.kind === "exit" ? 2 : 0);
    if (!best || score < best.score) best = { s, score };
  }
  return best?.s ?? null;
}

/** Walking into a doorway takes you through it. */
export function exitReached(pos: Pt, spots: Spot[]): Spot | null {
  return spots.find((s) => s.kind === "exit" && Math.hypot(s.x - pos.x, s.z - pos.z) < EXIT_RANGE) ?? null;
}

const hash = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Where people stand: at their own spot in the art if they have one, otherwise spread in an arc near the middle. */
export function personPositions(people: { id: string; anchor?: Pt }[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  const free = people.filter((p) => !p.anchor);
  free.forEach((p, i) => {
    const a = ((i + 0.5) / Math.max(1, free.length)) * Math.PI - Math.PI; // a half circle in front of the arrival point
    const r = 3 + (hash(p.id) % 100) / 100;
    out[p.id] = { x: clamp(Math.cos(a) * r, -LIMIT, LIMIT), z: clamp(0.5 + Math.sin(a) * r * 0.9, -LIMIT, LIMIT) };
  });
  for (const p of people) if (p.anchor) out[p.id] = p.anchor;
  return out;
}

export interface Env { outdoor: boolean; sky: string; ground: string; pillars: number; trees: number; seed: number }
const OUTDOOR = /court|garden|gate|quad|lawn|plaza|outside|yard|assembly|street|park|entrance/i;
/** Each room looks different: indoor halls get pillars, outdoor places get trees and a sky; colors come from the room's own art colors. */
export function envFor(roomId: string, gradient: [string, string]): Env {
  const seed = hash(roomId);
  const outdoor = OUTDOOR.test(roomId);
  return { outdoor, sky: gradient[0], ground: gradient[1], pillars: outdoor ? 0 : 4 + (seed % 5), trees: outdoor ? 10 + (seed % 9) : 0, seed };
}
