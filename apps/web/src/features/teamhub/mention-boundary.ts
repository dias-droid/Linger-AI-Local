/**
 * Whether a Mention or Skill token may start at `index` in `text`.
 *
 * A token starts at the beginning, after whitespace or punctuation, and after a
 * character of an unspaced script, which is why an at-sign straight after a Han
 * character starts a Mention.
 * A letter, a combining mark or a number that belongs to a script which separates
 * words with spaces keeps the token literal, so `иван@почта.рф`, `αβ@`, `الي@`,
 * a pasted `cafe` + U+0301 + `@` and `alice@example` stay plain text. A path or
 * address character (`_`, `@`, `/`) keeps it literal everywhere.
 */
const UNSPACED_SCRIPT =
  /[\p{Ideographic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_@/]/u;

export function startsMentionToken(text: string, index: number): boolean {
  const previous = [...text.slice(0, index)].at(-1);
  if (previous === undefined) return true;
  if (!WORD_CHARACTER.test(previous)) return true;
  return UNSPACED_SCRIPT.test(previous);
}
