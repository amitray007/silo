import type { SettingsSelectGroup } from '../../SettingsTabs/SettingsSelect';
import type { Voice } from './engines';

const LOCALES: Record<string, string> = {
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  en: 'English',
};

function localeName(code: string): string {
  return LOCALES[code.toLowerCase()] ?? code;
}

export function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(bytes > 10 * 1_048_576 ? 0 : 1);
}

/** The voice list: a default, then the engine's voices grouped by locale in engine order. */
export function voiceGroups(voices: readonly Voice[]): SettingsSelectGroup<string>[] {
  const byLocale = new Map<string, SettingsSelectGroup<string>['options']>();
  for (const voice of voices) {
    const name = localeName(voice.language);
    const options = byLocale.get(name) ?? [];
    options.push({
      value: voice.id,
      label: voice.label,
      ...(voice.trait ? { hint: voice.trait } : {}),
      triggerHint: voice.language.toUpperCase(),
    });
    byLocale.set(name, options);
  }
  return [
    { options: [{ value: '', label: 'Default voice', triggerLabel: 'Default' }] },
    ...[...byLocale].map(([label, options]) => ({ label, options })),
  ];
}
