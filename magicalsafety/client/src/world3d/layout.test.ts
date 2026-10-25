import { describe, expect, it } from "vitest";
import { arrival, doorPos, envFor, exitReached, floorPos, HALF, NO_KEYS, personPositions, pickTarget, stepMove, yawToward, type Spot } from "./layout";

const spot = (id: string, x: number, z: number, kind: Spot["kind"] = "person"): Spot => ({ id, kind, label: id, ref: id, x, z });

describe("walking", () => {
  it("moves where you look, and strafes and turns", () => {
    const s0 = { pos: { x: 0, z: 0 }, yaw: 0 };
    expect(stepMove(s0, { ...NO_KEYS, forward: true }, 1).pos.z).toBeLessThan(-3); // forward is -z at yaw 0
    expect(stepMove(s0, { ...NO_KEYS, back: true }, 1).pos.z).toBeGreaterThan(3);
    expect(stepMove(s0, { ...NO_KEYS, right: true }, 1).pos.x).toBeGreaterThan(3);
    expect(stepMove(s0, { ...NO_KEYS, turnLeft: true }, 0.5).yaw).toBeGreaterThan(0);
    const turned = stepMove({ pos: { x: 0, z: 0 }, yaw: Math.PI / 2 }, { ...NO_KEYS, forward: true }, 1); // turned left: forward is now -x
    expect(turned.pos.x).toBeLessThan(-3);
  });
  it("is stopped by the walls and is no faster on a diagonal", () => {
    let st = { pos: { x: 0, z: 0 }, yaw: 0 };
    for (let i = 0; i < 100; i++) st = stepMove(st, { ...NO_KEYS, forward: true, right: true }, 0.1);
    expect(Math.abs(st.pos.x)).toBeLessThanOrEqual(HALF);
    expect(Math.abs(st.pos.z)).toBeLessThanOrEqual(HALF);
    const one = stepMove({ pos: { x: 0, z: 0 }, yaw: 0 }, { ...NO_KEYS, forward: true, right: true }, 1).pos;
    expect(Math.hypot(one.x, one.z)).toBeCloseTo(3.4, 1);
  });
});

describe("what you are looking at", () => {
  it("picks the nearest thing in front of you, not behind you or off to the side", () => {
    const here = { x: 0, z: 0 };
    const spots = [spot("front", 0, -3), spot("far", 0, -5), spot("behind", 0, 3), spot("side", 4, 0)];
    expect(pickTarget(here, 0, spots)?.id).toBe("front");
    expect(pickTarget(here, Math.PI, spots)?.id).toBe("behind");
    expect(pickTarget(here, -Math.PI / 2, spots)?.id).toBe("side"); // turned right
    expect(pickTarget(here, 0, [spot("faraway", 0, -9)])).toBeNull();
  });
  it("prefers a person to a doorway behind them", () => {
    const t = pickTarget({ x: 0, z: 0 }, 0, [spot("door", 0, -4, "exit"), spot("ana", 0.2, -3.2)]);
    expect(t?.id).toBe("ana");
  });
  it("yawToward looks at a point", () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: -5 })).toBeCloseTo(0);
    expect(pickTarget({ x: 0, z: 0 }, yawToward({ x: 0, z: 0 }, { x: 3, z: -3 }), [spot("a", 3, -3)])?.id).toBe("a");
  });
});

describe("rooms and doorways", () => {
  it("puts doorways in the wall and takes you through when you walk into them", () => {
    const d = doorPos(12, 80);
    expect(Math.abs(d.x)).toBeGreaterThan(HALF - 1);
    const door: Spot = { ...spot("to_hall", d.x, d.z, "exit") };
    expect(exitReached({ x: d.x + 0.5, z: d.z }, [door])?.id).toBe("to_hall");
    expect(exitReached({ x: 0, z: 0 }, [door])).toBeNull();
  });
  it("arrival puts you inside the room, facing the middle", () => {
    const a = arrival(doorPos(92, 50));
    expect(Math.abs(a.pos.x)).toBeLessThan(HALF - 2);
    const ahead = spot("ahead", a.pos.x - Math.sin(a.yaw) * 3, a.pos.z - Math.cos(a.yaw) * 3);
    expect(pickTarget(a.pos, a.yaw, [ahead])?.id).toBe("ahead");
    // and that direction heads toward the middle of the room
    expect(Math.hypot(ahead.x, ahead.z)).toBeLessThan(Math.hypot(a.pos.x, a.pos.z));
  });
  it("keeps art positions on the floor and spreads people without a place", () => {
    expect(floorPos(50, 50)).toEqual({ x: 0, z: 0 });
    for (const [x, y] of [[0, 0], [100, 100], [150, -20]]) { const p = floorPos(x!, y!); expect(Math.abs(p.x)).toBeLessThan(HALF); expect(Math.abs(p.z)).toBeLessThan(HALF); }
    const pos = personPositions([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "v", anchor: { x: 1, z: -2 } }]);
    expect(pos.v).toEqual({ x: 1, z: -2 });
    expect(new Set(Object.values(pos).map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size).toBe(4);
  });
  it("makes every room look different, and the same room look the same each time", () => {
    const g: [string, string] = ["#123456", "#654321"];
    expect(envFor("lawn", g).outdoor).toBe(true);
    expect(envFor("atrium", g).outdoor).toBe(false);
    expect(envFor("atrium", g)).toEqual(envFor("atrium", g));
    expect(envFor("atrium", g).pillars).toBeGreaterThanOrEqual(4);
    expect(envFor("lawn", g).trees).toBeGreaterThanOrEqual(10);
    expect(new Set(["atrium", "desk", "cabinet", "stairwell", "lounge"].map((r) => envFor(r, g).seed)).size).toBe(5);
  });
});
