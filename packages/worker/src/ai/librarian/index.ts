import { setLibrarianRunner } from '@silo/core/ai-credential';
import { runLibrarian } from './run.js';
export function registerLibrarian(): { close: () => void } {
  setLibrarianRunner(runLibrarian);
  return { close: () => setLibrarianRunner(undefined) };
}
