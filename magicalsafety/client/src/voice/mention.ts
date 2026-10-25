// "Ask the guard", "Duchess", "Cinderella, can you help": which person in the room did the player name?
const STOP = new Set(["the", "and", "royal", "palace", "lady", "miss", "student", "from", "your", "you", "with", "please"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));

export interface Nameable { id: string; name: string; roleName?: string | null }

/** The one person whose name or role the text mentions most, or null when nobody (or two people equally) is named. */
export function findMentioned<T extends Nameable>(text: string, people: T[]): T | null {
  const said = new Set(words(text));
  if (said.size === 0) return null;
  const scored = people.map((p) => ({ p, n: new Set([...words(p.name), ...words(p.roleName ?? "")]) })).map(({ p, n }) => ({ p, hits: [...n].filter((w) => said.has(w)).length })).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits);
  if (!scored[0]) return null;
  if (scored[1] && scored[1].hits === scored[0].hits) return null;
  return scored[0].p;
}
