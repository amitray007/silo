import {
  setLibrarianRunner,
  setLibrarianSuggestionsRunner,
  setLibrarianTitleRunner,
} from '@silo/core/ai-credential';
import { languageModelFor } from '../model.js';
import { answerCredential } from './credential.js';
import { runLibrarian } from './run.js';
import { suggestFollowups } from './suggestions.js';
import { generateChatTitle } from './title.js';
export function registerLibrarian(): { close: () => void } {
  setLibrarianRunner(runLibrarian);
  setLibrarianTitleRunner(async (request) => {
    const credential = await answerCredential(undefined);
    return credential ? generateChatTitle(credential, languageModelFor(credential), request) : null;
  });
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
      setLibrarianTitleRunner(undefined);
    },
  };
}
