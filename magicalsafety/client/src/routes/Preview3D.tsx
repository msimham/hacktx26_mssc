// Development-only page that shows the first-person world with a real game state, so the 3D view can be checked without joining a game.
import { useMemo, useState } from "react";
import { viewFor } from "@magicalsafety/engine";
import { Driver } from "@magicalsafety/engine/testing";
import { makeInit } from "@magicalsafety/engine/testing/scenarios";
import { Crosshair } from "../components/Popups";
import { FirstPersonView } from "../world3d/FirstPersonView";
import { promptFor } from "../world3d/interactions";
import type { Spot } from "../world3d/layout";

export function Preview3D() {
  const params = new URLSearchParams(window.location.search);
  const view = useMemo(() => {
    const d = new Driver(makeInit({ config: { worldId: params.get("world") === "castle" ? "castle" : "campus" } }), true);
    d.wait(Number(params.get("t") ?? 30_000));
    const room = params.get("room");
    if (room) d.state.actors.p1!.roomId = room;
    return viewFor(d.state, "p1")!;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [target, setTarget] = useState<Spot | null>(null);
  return (
    <div className="relative h-dvh w-full bg-black">
      <FirstPersonView view={view} art={new Set()} paused={false} focusId={null} onTarget={setTarget} onInteract={() => undefined} onExit={() => undefined} onUnsupported={() => document.title = "NO-WEBGL"} />
      <Crosshair prompt={target ? promptFor(target.kind, target.label) : null} />
      <div className="absolute left-3 top-3 rounded bg-night/80 px-3 py-1 font-display text-gold">{view.room.name}</div>
    </div>
  );
}
