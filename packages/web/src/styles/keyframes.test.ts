import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(process.cwd(), 'src/styles');

describe('keyframes', () => {
  it('names each @keyframes once across all stylesheets', () => {
    // Keyframes are global: a second definition with the same name silently replaces the first
    // for every user (a status shimmer once turned the skeleton shimmer into a sliding block).
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(resolve(dir, file), 'utf8');
      for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
        if (name === undefined) continue;
        const first = seen.get(name);
        if (first !== undefined) duplicates.push(`${name}: ${first} and ${file}`);
        else seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
