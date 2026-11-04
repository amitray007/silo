import { setLibrarianRunner, setLibrarianSuggestionsRunner } from '@silo/core/ai-credential';
import { languageModelFor } from '../model.js';
import { answerCredential } from './credential.js';
import { runLibrarian } from './run.js';
import { suggestFollowups } from './suggestions.js';
export function registerLibrarian(): { close: () => void } {
  setLibrarianRunner(runLibrarian);
  setLibrarianSuggestionsRunner(async (question, answer, model) => {
    const credential = await answerCredential(model);
    return credential
      ? suggestFollowups(credential, languageModelFor(credential), question, answer)
      : null;
  });
  return {
    close: () => {
      setLibrarianRunner(undefined);
      setLibrarianSuggestionsRunner(undefined);
    },
  };
}
