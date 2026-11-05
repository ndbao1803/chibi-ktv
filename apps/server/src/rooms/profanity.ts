/**
 * A basic chat filter (P-05, CH-11): common Vietnamese and English swear words are masked with *.
 * Vietnamese words are matched WITH their accents, because without them many are ordinary words
 * ("lớn" big, "các" the, "đeo" wear). Short no-accent forms (vcl, đm…) are matched as written, and
 * may be split by dots or spaces ("Đ.M"). Deliberately small: a room of friends, not a forum.
 */
const WORDS = [
  // Vietnamese, with accents
  'địt', 'đụ', 'đéo', 'đếch', 'lồn', 'cặc', 'buồi', 'đĩ', 'đù má', 'đụ má', 'mẹ mày', 'óc chó', 'thằng chó',
  // Vietnamese short forms
  'đm', 'dm', 'đmm', 'dmm', 'đcm', 'dcm', 'đkm', 'dkm', 'vcl', 'vkl', 'clm', 'cmm',
  // English
  'fuck', 'fucking', 'motherfucker', 'shit', 'bitch', 'asshole', 'cunt', 'bastard',
];

const SEP = '[\\s._*-]?';
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${WORDS.map((w) => [...w].map((c) => (c === ' ' ? '\\s*' : escape(c))).join(SEP)).join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'giu',
);

/** Masks bad words, keeping everything else exactly as typed. */
export function cleanText(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return text; // unusual characters: leave rather than mis-mask
  let out = text;
  for (const m of lower.matchAll(PATTERN)) {
    const start = (m.index ?? 0) + m[1].length, len = m[2].length;
    out = out.slice(0, start) + '*'.repeat(len) + out.slice(start + len);
  }
  return out;
}
