/** Removes credentials from anything that is about to be logged or stored. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|secret)=([^&\s"]+)/gi, "$1=[redacted]");
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join("[redacted]");
  return out;
}

/**
 * Wraps reference material (org docs, approved web snippets) so a model treats it as data.
 * HTML is stripped and each chunk is capped; references can never change rules, tools or safety content.
 */
export function wrapUntrusted(chunks: { id: string; text: string }[]): string {
  return chunks
    .map((c) => {
      const clean = c.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
      return `<untrusted_reference id="${c.id.replace(/[^A-Za-z0-9_-]/g, "")}">${clean.replace(/<\/?untrusted_reference[^>]*>/gi, "")}</untrusted_reference>`;
    })
    .join("\n");
}
