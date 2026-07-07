import { beforeEach } from 'vitest';
import { installChromeMock } from './chrome-mock.js';

beforeEach(() => {
  installChromeMock();
});
