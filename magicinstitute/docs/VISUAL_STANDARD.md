# Visual standard

The detail bar for every generated world, taken from the Magical School of Safety asset pack
(`Downloads/Magical-School-of-Safety-Visual-Assets`). It is enforced in code, not just described:
`aep/library/visual_standard.py` (gates + prompt), `web/render/*` (the renderer that guarantees it).

## What "good" means here

| Area | Bar (from the reference) | Where it lives |
|---|---|---|
| Rendering | ACES tone mapping, 2048 sun shadow, spot + two warm point lights, RoomEnvironment image-based light, fog | `render/hall.js` `buildLights`, `render/stage.js` |
| Surfaces | Poly Haven stone + marble with diffuse/normal/roughness maps; clearcoat marble, sheen stone, brass trim | `render/core.js` `makeMaterials` |
| Architecture | Reflective checker marble floor, columns with plinth + capital stack + arc rib, extruded arched stained-glass windows with mullions, chandelier, tapestry with crown, fireplace when there is a fire | `render/hall.js` |
| Props | Beveled forms, brass fittings, glass, emissive accents, crown motif; no bare primitives | `render/props_safety.js`, `props_decor.js` |
| Effects | GLSL flame shader + flickering light + smoke + embers; spray particles; floating sparkles; completion bursts and rings | `render/effects.js` |
| Characters | Rigged GLB people with authored idle/greeting clips, costume recolour in bind-pose space, ornate nameplates | `render/characters.js`, `web/assets/models` |
| Text | The pack's scene + nameplate fonts, in-world labels | `render/core.js` `label` |
| Reaction | Nothing shrinks or vanishes when a step is done: the object *answers* (door swings open, lever swings down, pin drops, route draws on the map, receiver lifts, fire dies to embers) | `api.step()` in each prop |

## Rules for agents

1. The player renders the hall. Agents choose the **set** (castle / ballroom / lodge / modern), a harmonious **palette**, the mood,
   **4-8 scenery props**, and *at most 2 custom assets*, and only when no built-in or library kind fits.
2. Required props are placed deterministically from `SLOTS` (wall items flush to walls and facing in; floor items reachable) and every
   scene is topped up to at least 12 props with the default dressing. Nothing may be closer than 1.1 m to another prop.
3. A **custom asset** (an `AssetRecipe`) must have 8+ parts, 3+ shape types, 3+ material presets, a believable height (0.25-4 m) and its
   origin at its base. Anything below the bar is dropped before it can reach a player.
4. Every prop kind must answer when its step completes. Custom assets pick one of: pulse, open, lift, swing, unfold, glow, bounce, spin.
5. **Voice:** the learner plays the heroine and is addressed in the *second person*: plain and direct, a short question then what you should do
   ("Where do you aim? At the base of the fire. Point the nozzle low."). No first person, no puns, no filler. The validator rejects text that isn't.

## The asset library

```
asset_library/candidates/<kind>.json   passed the quality gate, awaiting a human
asset_library/library/<kind>.json      approved: becomes a real prop kind for every later scenario
```

* A new custom asset that clears the gate is saved as a **candidate** automatically.
* At the end of a play-through, and on **/assets.html**, you can see it turning and *keep* it (approve) or discard it.
* Approved assets are added to `known_prop_kinds()`, offered to the Builder in its prompt ("reuse before inventing"), and inlined into
  each spec that uses them, so the player needs no extra fetch.
* Seeded, hand-authored examples that meet the bar: `spinning_wheel`, `cauldron`.

## Adding a built-in prop

Write `kind(ctx, prop)` in `render/props_*.js` returning a Group with `userData.api = { update(dt,t), step(info) }`, register it in
`render/stage.js` `BUILDERS`, add the kind to `PROP_KINDS` in `aep/schema.py`, a slot in `SLOTS`, and a note in `KIND_NOTES`.
Check it on /assets.html. `step(info)` receives `{ mine, gesture, kind, index, total, last }` for every completed step.

## Performance

Full quality uses a mirror pass and 2048 shadows. `?lowfx=1` disables the mirror and halves shadow cost for weaker machines.
