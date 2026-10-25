// Development-only: starts the real hand tracker and reports what happened, so the camera pipeline can be checked in a browser run.
import { useEffect, useRef, useState } from "react";
import { startTracker, TrackerFailure } from "../vision/handTracker";

export function PreviewCam() {
  const [out, setOut] = useState({ state: "starting", frames: 0, hands: 0, error: "" });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development; start the camera once
    started.current = true;
    const video = document.getElementById("cam") as HTMLVideoElement;
    let frames = 0, hands = 0;
    startTracker(video, (lm) => { frames++; if (lm) hands++; setOut({ state: "running", frames, hands, error: "" }); })
      .catch((e) => setOut({ state: "failed", frames, hands, error: e instanceof TrackerFailure ? `${e.kind}: ${e.detail}` : String(e) }));
  }, []);
  return <div><video id="cam" playsInline muted width={320} height={240} /><pre id="out">{JSON.stringify(out)}</pre></div>;
}
