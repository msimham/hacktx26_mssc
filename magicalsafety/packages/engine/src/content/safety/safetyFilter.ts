import { APPROVED_PHRASES, BLOCKED_REPLACEMENT } from "./emergencyProtocol";

export interface SafetyResult {
  ok: boolean;
  text: string;
  /** Rule names that matched; logged as a policy event by callers. */
  reasons: string[];
}

const RULES: { name: string; re: RegExp }[] = [
  { name: "dosing", re: /\b\d+(\.\d+)?\s?(mg|mcg|µg|ml|cc|units?|tablets?|pills?|doses?)\b/i },
  { name: "medication", re: /\b(aspirin|ibuprofen|acetaminophen|paracetamol|epinephrine|epipen|adrenaline|insulin|nitroglycerin|naloxone|narcan|antibiotic|opioid|sedative|painkiller)\b/i },
  { name: "cpr_procedure", re: /\b(cpr|chest compressions?|compressions?|rescue breaths?|mouth[- ]to[- ]mouth|heimlich|abdominal thrusts?|recovery position|tilt (the |her |his )?head|head[- ]tilt|chin lift)\b/i },
  { name: "defibrillation_procedure", re: /\b(shock (her|him|them|the patient)|apply (the )?pads?|defibrillat\w*)\b/i },
  { name: "diagnosis", re: /\b(heart attack|cardiac arrest|stroke|seizure|epilep\w+|diabet\w+|hypoglyc\w+|anaphyla\w+|overdose|concussion|fracture|internal bleeding|aneurysm)\b/i },
  { name: "treatment_instruction", re: /\b(you (should|must|need to) (give|administer|inject|perform|apply|press|compress|tilt|roll))\b/i },
];

function stripApproved(text: string): string {
  let out = text;
  for (const phrase of APPROVED_PHRASES) {
    out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return out;
}

/** Every LLM text output passes through here. Blocked text is replaced by authored copy. */
export function safetyFilter(text: string): SafetyResult {
  const probe = stripApproved(text);
  const reasons = RULES.filter((r) => r.re.test(probe)).map((r) => r.name);
  if (reasons.length === 0) return { ok: true, text, reasons: [] };
  return { ok: false, text: BLOCKED_REPLACEMENT, reasons };
}
