// Reading the guide aloud uses the browser's built-in speech. The Meta Model API facts this project was built from list speech-to-text
// (Muse Voice Transcribe, used for the microphone) but no text-to-speech model, so none is called.
// TODO(VERIFY): If Meta publishes a text-to-speech model, add it behind the server's tool pipeline like the other Muse tools.
export function canSpeak(): boolean { return typeof window !== "undefined" && "speechSynthesis" in window; }
export function speak(text: string): void {
  if (!canSpeak()) return;
  try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = 1.1; window.speechSynthesis.speak(u); } catch { /* speech is optional */ }
}
export function stopSpeaking(): void { try { if (canSpeak()) window.speechSynthesis.cancel(); } catch { /* ignore */ } }
