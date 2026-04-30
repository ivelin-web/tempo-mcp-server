/**
 * Per-user credential storage for the remote MCP server.
 *
 * Layout in KV (`USERS` namespace):
 *   user:<userId>           — AES-GCM(JSON of UserCredentials) base64
 *
 * Encryption is AES-GCM 256 with a fresh 12-byte IV per record. The key is
 * derived once per Worker isolate from the `ENCRYPTION_KEY` Worker secret via
 * SHA-256 — sufficient for a static secret of ≥32 high-entropy bytes.
 *
 * Note: rotating `ENCRYPTION_KEY` invalidates every existing user record (the
 * AES-GCM tag won't validate), so users would need to re-run /setup. Treat
 * the key as long-lived.
 */

export interface UserCredentials {
  // Tempo
  tempoApiToken: string;

  // Jira
  jiraBaseUrl: string;
  jiraAuthType: 'basic' | 'bearer';
  jiraApiToken: string;
  /** Required for basic auth, ignored for bearer. */
  jiraEmail?: string;
  /** Optional Tempo account custom-field id (numeric, no `customfield_` prefix). */
  jiraTempoAccountCustomFieldId?: string;
}

export interface StorageEnv {
  USERS: KVNamespace;
  ENCRYPTION_KEY: string;
}

const USER_PREFIX = 'user:';

let cachedKey: CryptoKey | null = null;
let cachedKeyMaterial: string | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeyMaterial === secret) return cachedKey;
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  cachedKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKeyMaterial = secret;
  return cachedKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // pack iv|ciphertext as a single base64 blob
  const ctBytes = new Uint8Array(ct);
  const merged = new Uint8Array(iv.length + ctBytes.length);
  merged.set(iv, 0);
  merged.set(ctBytes, iv.length);
  return bytesToBase64(merged);
}

async function decrypt(blob: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const merged = base64ToBytes(blob);
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Generate an opaque user id: `u_` followed by 22 base64url chars (16 bytes
 * → ~128 bits of entropy).
 */
export function generateId(prefix: 'u'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // base64url: + → -, / → _, strip =
  const b64 = bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}_${b64}`;
}

export async function putCredentials(
  env: StorageEnv,
  userId: string,
  creds: UserCredentials,
): Promise<void> {
  const blob = await encrypt(JSON.stringify(creds), env.ENCRYPTION_KEY);
  await env.USERS.put(`${USER_PREFIX}${userId}`, blob);
}

export async function getCredentials(
  env: StorageEnv,
  userId: string,
): Promise<UserCredentials | null> {
  const blob = await env.USERS.get(`${USER_PREFIX}${userId}`);
  if (!blob) return null;
  try {
    const json = await decrypt(blob, env.ENCRYPTION_KEY);
    return JSON.parse(json) as UserCredentials;
  } catch {
    return null;
  }
}

/**
 * Validate a user id matches the `u_<base64url>` shape we emit.
 * Cheap rejection of obviously-malformed paths before a KV lookup.
 */
export function isValidId(id: string, prefix: 'u'): boolean {
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]{20,32}$`).test(id);
}
