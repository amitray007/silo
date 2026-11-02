/**
 * Read aloud speaks English only for now: Phonon 31m is English, and kokoro-js ships English
 * voices and an English phonemizer. The stored reader carries no language field, so the article's
 * language is read from its text: a non-Latin script, or Latin text with almost none of the
 * common English words, is not English. Text too short to judge counts as English.
 */

const MIN_LETTERS = 80;
/** Past this share of non-Latin letters the text is another script. */
const FOREIGN_SCRIPT_SHARE = 0.3;
/** English prose has about a third of its words in this list; other Latin-script languages ~0-3%. */
const ENGLISH_WORD_SHARE = 0.1;
const SAMPLE_CHARS = 4000;

const COMMON_ENGLISH = new Set(
  (
    'the be to of and a in that have i it for not on with he as you do at this but his by from ' +
    'they we say her she or an will my one all would there their what so up out if about who get ' +
    'which go me when make can like time no just him know take people into year your good some ' +
    'could them see other than then now look only come its over think also back after use two how ' +
    'our work first well way even new want because any these give day most us is are was were been ' +
    'has had more very'
  ).split(' '),
);

export function isEnglishText(text: string): boolean {
  const sample = text.slice(0, SAMPLE_CHARS);
  const letters = sample.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS) return true;
  const latin = sample.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if ((letters.length - latin) / letters.length > FOREIGN_SCRIPT_SHARE) return false;
  const words = sample.toLowerCase().match(/\p{L}+(?:'\p{L}+)?/gu) ?? [];
  if (words.length === 0) return true;
  const common = words.filter((word) => COMMON_ENGLISH.has(word)).length;
  return common / words.length >= ENGLISH_WORD_SHARE;
}

/** The title the dock gives the disabled Listen button. */
export const ENGLISH_ONLY_TITLE = 'Read aloud is English-only for now';
