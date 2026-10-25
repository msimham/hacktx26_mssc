import { describe, expect, it } from "vitest";
import { TaskGestures, taskPoseOf, countFingers, gestureOptions, GestureController, poseOf, type GestureEvent, type Landmarks, type Pt } from "./gestures";

/**
 * A synthetic hand: wrist near the bottom, each finger either out (tip far from the wrist) or folded (tip tucked in).
 * `rot` turns the whole hand, to show counting does not depend on it pointing straight up.
 */
function hand(extended: boolean[], opts: { x?: number; rot?: number } = {}): Landmarks {
  const { x = 0.5, rot = 0 } = opts;
  const wrist: Pt = { x, y: 0.85 };
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ ...wrist }));
  const place = (i: number, r: number, angle: number) => { pts[i] = { x: wrist.x + r * Math.sin(angle + rot), y: wrist.y - r * Math.cos(angle + rot) }; };
  const angles = [-0.35, -0.12, 0.05, 0.22]; // index..pinky fan out a little
  [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]].forEach(([mcp, pip, tip], f) => {
    place(mcp!, 0.18, angles[f]!);
    place(pip!, 0.3, angles[f]!);
    place(tip!, extended[f + 1] ? 0.55 : 0.2, angles[f]!); // folded: tip back near the knuckle, closer than the pip joint
  });
  // Thumb: base near the index knuckle; out = tip far from it, tucked = tip close
  place(1, 0.1, -0.7); place(2, 0.15, -0.8);
  place(3, 0.25, -0.9);
  place(4, extended[0] ? 0.42 : 0.17, extended[0] ? -1.25 : -0.45);
  return pts;
}
const open = (o?: { x?: number; rot?: number }) => hand([true, true, true, true, true], o);
const fist = () => hand([false, false, false, false, false]);
const fingers = (n: number) => hand([false, ...[0, 1, 2, 3].map((i) => i < n)]);

const run = (c: GestureController, frames: { lm: Landmarks | null; t: number }[]) => frames.flatMap((f) => c.feed(f.lm, f.t));
const hold = (lm: Landmarks | null, from: number, to: number, step = 50) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => ({ lm, t: from + i * step }));
const types = (evs: GestureEvent[], t: GestureEvent["type"]) => evs.filter((e) => e.type === t);

describe("reading a hand", () => {
  it("counts fingers 0 to 5", () => {
    expect(countFingers(fist())).toBe(0);
    for (let n = 1; n <= 4; n++) expect(countFingers(fingers(n))).toBe(n);
    expect(countFingers(open())).toBe(5);
  });
  it("does not depend on the hand pointing straight up", () => {
    for (const rot of [-1.2, -0.6, 0.6, 1.2, 2.5]) { expect(countFingers(open({ rot }))).toBe(5); expect(countFingers(fist())).toBe(0); expect(countFingers(hand([false, true, true, false, false], { rot }))).toBe(2); }
  });
  it("names the poses, and handles no hand and bad data", () => {
    expect(poseOf(fist())).toBe("fist");
    expect(poseOf(open())).toBe("palm");
    expect(poseOf(fingers(3))).toBe("count3");
    expect(poseOf(null)).toBe("none");
    expect(countFingers([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe("turning a hand into intentions", () => {
  const make = (options = 5) => new GestureController(() => options);

  it("highlights option N when N fingers are held steady, but not for a flicker", () => {
    const c = make();
    expect(types(run(c, hold(fingers(3), 0, 200)), "highlight")).toHaveLength(0); // not steady yet
    const steady = run(make(), hold(fingers(3), 0, 400));
    expect(types(steady, "highlight")).toEqual([{ type: "highlight", index: 2 }]);
    const flicker = run(make(), [...hold(fingers(2), 0, 100), ...hold(fingers(4), 150, 250), ...hold(fingers(1), 300, 400)]);
    expect(types(flicker, "highlight")).toHaveLength(0);
  });

  it("never highlights beyond the number of options", () => {
    expect(types(run(make(2), hold(fingers(4), 0, 400)), "highlight")).toEqual([{ type: "highlight", index: 1 }]);
    expect(types(run(make(0), hold(fingers(2), 0, 400)), "highlight")).toHaveLength(0);
  });

  it("confirms only after the open palm is held long enough, and only if something is highlighted", () => {
    const c = make();
    const evs = run(c, [...hold(fingers(2), 0, 400), ...hold(open(), 450, 2000)]);
    expect(types(evs, "confirm")).toEqual([{ type: "confirm", index: 1 }]);
    const confirmAt = 450; // the palm began here; stable at +250, then held 800
    const first = evs.findIndex((e) => e.type === "confirm");
    expect(first).toBeGreaterThan(0);
    const progress = types(evs, "progress").filter((e) => e.type === "progress" && e.intent === "confirm" && e.value > 0 && e.value < 1);
    expect(progress.length).toBeGreaterThan(3);
    void confirmAt;
    // palm with nothing highlighted: nothing happens
    expect(types(run(make(), hold(open(), 0, 3000)), "confirm")).toHaveLength(0);
  });

  it("stopping early resets the hold", () => {
    const c = make();
    const evs = run(c, [...hold(fingers(1), 0, 400), ...hold(open(), 450, 1000), ...hold(fingers(2), 1050, 1400), ...hold(open(), 1450, 1900)]);
    expect(types(evs, "confirm")).toHaveLength(0); // neither palm was held for the full time
  });

  it("does not confirm twice in a row; it needs the hand to change first", () => {
    const c = make();
    const evs = run(c, [...hold(fingers(1), 0, 400), ...hold(open(), 450, 4000)]);
    expect(types(evs, "confirm")).toHaveLength(1);
    const again = run(c, [...hold(fingers(3), 4100, 4500), ...hold(open(), 4550, 6500)]);
    expect(types(again, "confirm")).toEqual([{ type: "confirm", index: 2 }]);
  });

  it("a held fist cancels and clears the highlight", () => {
    const c = make();
    const evs = run(c, [...hold(fingers(2), 0, 400), ...hold(fist(), 450, 2000)]);
    expect(types(evs, "cancel")).toHaveLength(1);
    expect(c.current).toBe(-1);
    // and now a palm has nothing to confirm
    expect(types(run(c, hold(open(), 2100, 5000)), "confirm")).toHaveLength(0);
  });

  it("swiping moves the highlight, in the user's own left and right (mirrored), and clamps at the ends", () => {
    const c = make(3);
    // the user moves their hand to THEIR right: in a non-mirrored camera image x gets smaller
    const toRight = Array.from({ length: 10 }, (_, i) => ({ lm: open({ x: 0.7 - i * 0.04 }), t: i * 40 }));
    const e1 = run(c, toRight);
    expect(types(e1, "move")).toEqual([{ type: "move", delta: 1 }]);
    expect(c.current).toBe(0);
    const toLeft = Array.from({ length: 10 }, (_, i) => ({ lm: open({ x: 0.3 + i * 0.04 }), t: 400 + i * 40 }));
    run(c, toLeft);
    expect(c.current).toBe(0); // already at the first option
    expect(types(run(make(3), toLeft), "move")).toEqual([{ type: "move", delta: -1 }]);
  });

  it("a slow drift is not a swipe", () => {
    const slow = Array.from({ length: 40 }, (_, i) => ({ lm: open({ x: 0.7 - i * 0.004 }), t: i * 100 }));
    expect(types(run(make(), slow), "move")).toHaveLength(0);
  });

  it("losing the hand resets everything", () => {
    const c = make();
    const evs = run(c, [...hold(fingers(2), 0, 400), ...hold(open(), 450, 900), ...hold(null, 950, 1000)]);
    expect(types(evs, "lost")).toHaveLength(1);
    expect(types(run(c, hold(open(), 1100, 3000)), "confirm")).toHaveLength(0); // the highlight was cleared when the hand left, so a palm has nothing to confirm
  });
});

describe("which action N fingers picks", () => {
  it("orders by hotkey and skips typed-text actions", () => {
    const got = gestureOptions([{ hotkey: 3 }, { hotkey: 1, needsText: true }, { hotkey: 2 }, {}]);
    expect(got).toEqual([{ hotkey: 2 }, { hotkey: 3 }]);
  });
});

const poseHand = (n: Parameters<typeof hand>[0]) => hand(n);
describe("task gestures", () => {
  it("recognizes the hand shapes that mean something", () => {
    expect(taskPoseOf(poseHand([false, true, false, false, false]))).toBe("point");
    expect(taskPoseOf(poseHand([true, false, false, false, true]))).toBe("phone");
    expect(taskPoseOf(poseHand([true, true, true, true, true]))).toBe("stop");
    expect(taskPoseOf(poseHand([true, false, false, false, false]))).toBe("thumbs_up");
    expect(taskPoseOf(poseHand([false, false, false, false, false]))).toBe("fist");
    expect(taskPoseOf(poseHand([false, true, true, false, false]))).toBe("none"); // a peace sign means nothing here
    expect(taskPoseOf(null)).toBe("none");
  });
  it("fires a pose only after it is held, then needs the hand to change", () => {
    const g = new TaskGestures();
    const ev = (lm: Landmarks | null, t: number) => g.feed(lm, t).filter((e) => e.type === "pose");
    const phone = poseHand([true, false, false, false, true]);
    expect(ev(phone, 0)).toHaveLength(0);
    expect(ev(phone, 300)).toHaveLength(0); // not held long enough yet
    expect(ev(phone, 800)).toEqual([{ type: "pose", pose: "phone" }]);
    expect(ev(phone, 3000)).toHaveLength(0); // still holding the same pose: no repeat
    expect(ev(poseHand([false, true, false, false, false]), 3100)).toHaveLength(0);
    expect(ev(poseHand([false, true, false, false, false]), 3500)).toEqual([{ type: "pose", pose: "point" }]);
  });
  it("a flicker or losing the hand cancels the hold", () => {
    const g = new TaskGestures();
    const phone = poseHand([true, false, false, false, true]);
    g.feed(phone, 0); g.feed(phone, 500);
    g.feed(null, 600);
    expect(g.feed(phone, 700).filter((e) => e.type === "pose")).toHaveLength(0);
    expect(g.feed(phone, 1500).filter((e) => e.type === "pose")).toHaveLength(1);
  });
});
