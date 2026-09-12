/**
 * A banner for every conference, whether or not anyone has published one.
 *
 * The hero was a flat dark panel with the conference's initials ghosted into it, because
 * `image_url` is null for every record in the catalogue — no page has been read, so no picture has
 * been found. That reads as a page that failed to load rather than a conference nobody has
 * published artwork for, and it is the first thing on the screen.
 *
 * So the fallback is drawn rather than fetched. It claims nothing: no logo, no photograph, no
 * typography borrowed from an organiser — a field of colour and geometry keyed to what the
 * conference is about, which is decoration and reads as decoration. A real banner, where a source
 * supplies one, is an image of the conference and always wins.
 *
 * It is deterministic in the title, so a conference keeps the same banner across rebuilds and two
 * conferences sitting next to each other do not come out the same.
 */

/** Stable small hash. Same title, same banner, every render and every deploy. */
function seedOf(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Palettes by subject, because a geoscience convention and an AI summit should not feel alike.
 *  Each is [far, near] of a dark gradient — the page lays white text over it. */
const PALETTES: Record<string, Array<[string, string]>> = {
  geo: [["#0c2a4d", "#1b5e5a"], ["#13314f", "#2a5d4e"], ["#0f2f3f", "#4a5d3a"]],
  ai: [["#1a1148", "#3b1d6e"], ["#111a4a", "#1e4d8f"], ["#241046", "#5b2a86"]],
  health: [["#07303a", "#0f5f5c"], ["#10233f", "#1a6a6a"], ["#0a2b33", "#2b6e6e"]],
  energy: [["#2a1608", "#7a3b0c"], ["#331a06", "#8a5a12"], ["#22160a", "#6b4a10"]],
  food: [["#1d2b10", "#4d6b16"], ["#26260c", "#6b6a18"], ["#1a2a14", "#3f6b2a"]],
  business: [["#141a2e", "#2b3a5e"], ["#1a1a2e", "#3a3a6e"], ["#101828", "#25406b"]],
  default: [["#111827", "#1f3a5f"], ["#161a2e", "#2e3d63"], ["#0f1a2b", "#26456b"]],
};

/** The family a conference's subject belongs to. Read from what the record already says it is. */
export function bannerFamily(category: string | null | undefined, title = ""): keyof typeof PALETTES {
  const text = `${category ?? ""} ${title}`.toLowerCase();
  if (/geo|petroleum|earth|mining|seismic|water|desalination|climate/.test(text)) return "geo";
  if (/\bai\b|artificial intelligence|machine learning|robot|computing|computer|data|software|cyber|digital/.test(text)) return "ai";
  if (/health|medic|clinic|nurs|vaccine|cancer|bio|pharma|radiolog|neuro|disease/.test(text)) return "health";
  if (/energy|power|oil|gas|solar|nuclear|hydrogen|electric/.test(text)) return "energy";
  if (/food|dairy|agri|nutrition|protein|beverage/.test(text)) return "food";
  if (/business|finance|market|management|leadership|summit|expo|trade/.test(text)) return "business";
  return "default";
}

export interface ConferenceBanner {
  /** Ready for `style={{ backgroundImage }}` — the whole banner, in one value. */
  backgroundImage: string;
}

/** An accent for each family, used for the glows layered over the base gradient. */
const ACCENTS: Record<string, [string, string]> = {
  geo: ["56,189,180", "250,204,21"],
  ai: ["129,140,248", "56,189,248"],
  health: ["45,212,191", "125,211,252"],
  energy: ["251,146,60", "253,224,71"],
  food: ["163,230,53", "250,204,21"],
  business: ["96,165,250", "167,139,250"],
  default: ["96,165,250", "45,212,191"],
};

export function conferenceBanner(title: string, category?: string | null): ConferenceBanner {
  const seed = seedOf(title || "conference");
  const family = bannerFamily(category, title);
  const choices = PALETTES[family];
  const [far, near] = choices[seed % choices.length];
  const [warm, cool] = ACCENTS[family];
  const angle = 100 + (seed % 60);

  // Layered gradients rather than an SVG: they always paint, cost nothing to send, and give the
  // banner depth — two soft glows at positions the title picks, over a directional field of colour.
  // Nothing here depicts the conference, which is the point: a drawn banner must never be
  // mistakable for artwork its organiser published.
  const glowX = 12 + (seed % 70);
  const glowY = 18 + ((seed >> 3) % 50);
  const glow2X = 55 + ((seed >> 5) % 40);
  const glow2Y = 55 + ((seed >> 7) % 40);

  const backgroundImage = [
    `radial-gradient(ellipse 55% 80% at ${glowX}% ${glowY}%, rgba(${cool},0.34), transparent 62%)`,
    `radial-gradient(ellipse 48% 70% at ${glow2X}% ${glow2Y}%, rgba(${warm},0.22), transparent 60%)`,
    `radial-gradient(circle at 85% 12%, rgba(255,255,255,0.10), transparent 45%)`,
    `linear-gradient(${angle}deg, ${far} 0%, ${near} 100%)`,
  ].join(", ");

  return { backgroundImage };
}
