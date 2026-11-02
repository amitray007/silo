import { describe, expect, it } from 'vitest';
import { isEnglishText } from './language';

const ENGLISH =
  'The history of the web is a story about how people wanted to share what they knew with the ' +
  'rest of the world, and it is told here for anyone who has ever wondered how it all began.';

describe('isEnglishText', () => {
  it('accepts English prose', () => {
    expect(isEnglishText(ENGLISH)).toBe(true);
  });

  it('treats text too short to judge as English', () => {
    expect(isEnglishText('Bonjour tout le monde')).toBe(true);
    expect(isEnglishText('')).toBe(true);
  });

  it('rejects a non-Latin script', () => {
    expect(isEnglishText('これは日本語で書かれた記事です。'.repeat(12))).toBe(false);
    expect(isEnglishText('Это статья, написанная по-русски. '.repeat(10))).toBe(false);
  });

  it('rejects Latin-script text in another language', () => {
    const french =
      'La ville de Paris est la capitale de la France et elle accueille chaque année des millions de ' +
      'visiteurs venus du monde entier pour admirer ses monuments, ses musées et ses jardins célèbres.';
    const german =
      'Die Hauptstadt von Deutschland ist Berlin, eine Stadt mit einer bewegten Geschichte und vielen ' +
      'Sehenswürdigkeiten, die jedes Jahr Millionen von Besuchern aus aller Welt anziehen.';
    expect(isEnglishText(french)).toBe(false);
    expect(isEnglishText(german)).toBe(false);
  });

  it('judges only the start of a long article', () => {
    expect(isEnglishText(`${ENGLISH.repeat(30)} ${'ça et là, '.repeat(2000)}`)).toBe(true);
  });
});
