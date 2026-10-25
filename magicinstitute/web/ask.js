// "Ask" corner button: hold to talk (or hold V) -> server relays to Muse Voice Transcribe -> short answer from Muse Spark.
// Text input is the fallback when there is no mic or no key. Answers are shown, never spoken.
const $ = id => document.getElementById(id);
const RATE = 16000, MAX_MS = 30000;

export function wavOf(chunks, inRate) {
  let n = chunks.reduce((a, c) => a + c.length, 0), flat = new Float32Array(n), o = 0;
  for (const c of chunks) { flat.set(c, o); o += c.length; }
  const step = inRate / RATE, len = Math.floor(n / step), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {                       // average each window down to 16 kHz
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)); let s = 0;
    for (let j = a; j < b && j < n; j++) s += flat[j];
    pcm[i] = Math.max(-1, Math.min(1, s / (b - a))) * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf), w = (p, s) => [...s].forEach((c, k) => v.setUint8(p + k, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, len * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

export function initAsk(getContext, programId = "") {
  const btn = $("askbtn"), panel = $("askpanel"), qEl = $("askq"), aEl = $("aska");
  let rec = null, busy = false, voiceOK = true;
  fetch("/api/voice/status").then(r => r.json()).then(s => { voiceOK = s.transcribe; if (!voiceOK) btn.textContent = "💬 Ask"; }).catch(() => {});

  const show = (q, a, err = false) => { panel.hidden = false; qEl.textContent = q ? `You asked: ${q}` : ""; aEl.textContent = a; aEl.className = err ? "err" : ""; };

  async function ask(question) {
    if (busy) return; busy = true; btn.disabled = true; show(question, "Thinking…");
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context: getContext(), program_id: programId }) });
      const j = await r.json(); show(question, r.ok ? j.answer : j.detail || "Could not answer.", !r.ok);
    } catch { show(question, "Could not reach the guide.", true); }
    busy = false; btn.disabled = false;
  }

  async function start() {
    if (rec || busy) return;
    if (!voiceOK) { panel.hidden = false; $("asktext").focus(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
      proc.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(proc); proc.connect(ctx.destination);
      rec = { stream, ctx, proc, src, chunks, timer: setTimeout(stop, MAX_MS) };
      btn.classList.add("rec"); btn.textContent = "● Listening… release to ask"; show("", "Listening…");
    } catch { voiceOK = false; btn.textContent = "💬 Ask"; show("", "No microphone access. Type your question below instead.", true); $("asktext").focus(); }
  }

  async function stop() {
    if (!rec) return; const { stream, ctx, proc, src, chunks, timer } = rec; rec = null; clearTimeout(timer);
    proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop());
    const rate = ctx.sampleRate; ctx.close();
    btn.classList.remove("rec"); btn.textContent = "🎤 Ask";
    if (!chunks.length) return show("", "I didn't hear anything. Hold the button while you speak.", true);
    busy = true; btn.disabled = true; show("", "Transcribing…");
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wavOf(chunks, rate) });
      const j = await r.json(); busy = false; btn.disabled = false;
      if (!r.ok) return show("", j.detail || "Could not transcribe.", true);
      if (!j.text) return show("", "I didn't catch that. Try again, a little closer to the mic.", true);
      ask(j.text);
    } catch { busy = false; btn.disabled = false; show("", "Could not reach the transcription service.", true); }
  }

  btn.addEventListener("pointerdown", e => { e.preventDefault(); start(); });
  addEventListener("pointerup", stop); btn.addEventListener("pointerleave", () => {});
  addEventListener("keydown", e => { if (e.key.toLowerCase() === "v" && !e.repeat && !e.target.matches?.("input,textarea")) start(); });
  addEventListener("keyup", e => { if (e.key.toLowerCase() === "v") stop(); });
  $("askform").addEventListener("submit", e => { e.preventDefault(); const q = $("asktext").value.trim(); if (q) { $("asktext").value = ""; ask(q); } });
  addEventListener("keydown", e => { if (e.key === "Escape") panel.hidden = true; });
  return { ask };
}
