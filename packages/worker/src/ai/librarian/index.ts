import {
  resolveAiFeatureCredential,
  setLibrarianRunner,
  setLibrarianSuggestionsRunner,
} from '@silo/core/ai-credential';
import { languageModelFor } from '../model.js';
import { runLibrarian } from './run.js';
import { suggestFollowups } from './suggestions.js';
export function registerLibrarian(): { close: () => void } {
  setLibrarianRunner(runLibrarian);
  setLibrarianSuggestionsRunner(async (question, answer) => {
    const credential = await resolveAiFeatureCredential('librarian');
    return credential
      ? suggestFollowups(credential, languageModelFor(credential), question, answer)
      : [];
  });
  return {
    close: () => {
      setLibrarianRunner(undefined);
      setLibrarianSuggestionsRunner(undefined);
    },
  };
}
