import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for provider API keys (AI foundation). AES-256-GCM via
 * `node:crypto`; no library, because the whole job is about 60 lines and it
 * guards a trust boundary.
 *
 * Keys come from the environment and are read fresh on every call (like
 * `auth/token.ts`), so tests and operators can change them without a reload:
 * - `SILO_SECRET_KEY`: base64 of exactly 32 random bytes (`openssl rand -base64 32`).
 * - `SILO_SECRET_KEY_PREVIOUS`: optional comma list of older keys, used only to
 *   decrypt during rotation.
 *
 * Blob format: `v1.<kid>.<iv>.<tag>.<ciphertext>`, each part base64url, except
 * `kid`, which is the first 8 hex characters of SHA-256 of the key. The AAD
 * binds a blob to its row, so a ciphertext copied elsewhere fails to decrypt.
 *
 * Nothing here logs or returns key material. Failures are `undefined`/`false`
 * with no detail, so an error path cannot leak.
 */

const KEY_ENV = 'SILO_SECRET_KEY';
const PREVIOUS_ENV = 'SILO_SECRET_KEY_PREVIOUS';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';
const BASE64_SHAPE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Thrown by `encryptSecret` when `SILO_SECRET_KEY` is unset or malformed. */
export class SecretKeyMissingError extends Error {
  constructor() {
    super('SILO_SECRET_KEY is missing or invalid');
    this.name = 'SecretKeyMissingError';
  }
}

type KeyEntry = { kid: string; key: Buffer };

function parseKey(raw: string): KeyEntry | undefined {
  const text = raw.trim();
  if (!BASE64_SHAPE.test(text)) return undefined;
  const key = Buffer.from(text, 'base64');
  if (key.length !== KEY_BYTES) return undefined;
  return { kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

function currentKey(): KeyEntry | undefined {
  const raw = process.env[KEY_ENV];
  return raw ? parseKey(raw) : undefined;
}

/** Every usable key: current first, then the valid entries of the previous list. */
function allKeys(): KeyEntry[] {
  const entries: KeyEntry[] = [];
  const current = currentKey();
  if (current) entries.push(current);
  for (const part of (process.env[PREVIOUS_ENV] ?? '').split(',')) {
    const entry = part.trim() ? parseKey(part) : undefined;
    if (entry) entries.push(entry);
  }
  return entries;
}

/** `missing` when `SILO_SECRET_KEY` is unset or empty, `invalid` when it is not 32 base64 bytes. */
export function secretKeyStatus(): 'ok' | 'missing' | 'invalid' {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.trim().length === 0) return 'missing';
  return parseKey(raw) ? 'ok' : 'invalid';
}

/** Encrypts `plaintext` with the current key. Throws `SecretKeyMissingError` when there is none. */
export function encryptSecret(plaintext: string, aad: string): string {
  const current = currentKey();
  if (!current) throw new SecretKeyMissingError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    current.kid,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

type ParsedBlob = { kid: string; iv: Buffer; tag: Buffer; ciphertext: Buffer };

function parseBlob(blob: string): ParsedBlob | undefined {
  const parts = blob.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return undefined;
  const [, kid, iv, tag, ciphertext] = parts;
  if (kid === undefined || iv === undefined || tag === undefined || ciphertext === undefined) {
    return undefined;
  }
  const parsed = {
    kid,
    iv: Buffer.from(iv, 'base64url'),
    tag: Buffer.from(tag, 'base64url'),
    ciphertext: Buffer.from(ciphertext, 'base64url'),
  };
  if (parsed.iv.length !== IV_BYTES || parsed.tag.length !== TAG_BYTES) return undefined;
  return parsed;
}

/** Decrypts a blob with whichever configured key matches its `kid`. `undefined` on ANY failure. */
export function decryptSecret(blob: string, aad: string): string | undefined {
  try {
    const parsed = parseBlob(blob);
    if (!parsed) return undefined;
    const entry = allKeys().find((candidate) => candidate.kid === parsed.kid);
    if (!entry) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', entry.key, parsed.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** `true` when the blob is well formed, a current key exists, and the blob names a different key. */
export function needsReencrypt(blob: string): boolean {
  const current = currentKey();
  const parsed = parseBlob(blob);
  return current !== undefined && parsed !== undefined && parsed.kid !== current.kid;
}
