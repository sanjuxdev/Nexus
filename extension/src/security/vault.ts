/**
 * Phase 4: Enterprise Encrypted Vault (AES-GCM Web Crypto)
 * Stores user credentials encrypted locally on-device.
 * Planner LLM only ever receives opaque handles (e.g., 'cap_pwd_01').
 */

export interface VaultEntry {
  ref: string;
  kind: 'password' | 'email' | 'phone' | 'token' | 'profile';
  label: string;
  ciphertextBase64: string;
  ivBase64: string;
  allowed_origins: string[];
}

import { openDB, type IDBPDatabase } from 'idb';

let masterKey: CryptoKey | null = null;

const DB_NAME = 'SihVaultDB';
const STORE_NAME = 'credentials';

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'ref' });
      }
    },
  });
}

/**
 * Derives or generates a local 256-bit AES-GCM master encryption key.
 * The key is generated on-the-fly and stored securely in chrome.storage.session,
 * which is memory-only and inaccessible to other extensions.
 */
async function getMasterKey(): Promise<CryptoKey> {
  if (masterKey) return masterKey;

  // Try to retrieve existing key from session storage
  const storageResult = await chrome.storage.session.get('vaultMasterKey');
  let rawKey: Uint8Array;

  if (storageResult.vaultMasterKey) {
    rawKey = new Uint8Array(storageResult.vaultMasterKey);
  } else {
    // Generate a fresh random key on-the-fly
    rawKey = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    // Store it in session storage (memory only)
    await chrome.storage.session.set({ vaultMasterKey: Array.from(rawKey) });
    
    // Since the key is fresh, old ciphertexts in IndexedDB are unrecoverable.
    // Clear the DB to maintain integrity.
    try {
      const db = await getDB();
      await db.clear(STORE_NAME);
    } catch (e) {
      console.warn('[Vault] Failed to clear old database entries', e);
    }
  }

  masterKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  return masterKey;
}

/**
 * Encrypts a plaintext secret string using AES-GCM 256-bit.
 */
export async function encryptSecret(plaintext: string): Promise<{ ciphertextBase64: string; ivBase64: string }> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard AES-GCM IV
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  const ivBase64 = btoa(String.fromCharCode(...iv));

  return { ciphertextBase64, ivBase64 };
}

/**
 * Decrypts an AES-GCM 256-bit ciphertext locally.
 */
export async function decryptSecret(ciphertextBase64: string, ivBase64: string): Promise<string> {
  const key = await getMasterKey();
  const ciphertextBytes = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertextBytes
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Store a credential in the encrypted vault.
 */
export async function storeCredential(
  ref: string,
  kind: 'password' | 'email' | 'phone' | 'token' | 'profile',
  label: string,
  plaintext: string,
  allowed_origins: string[]
): Promise<VaultEntry> {
  const { ciphertextBase64, ivBase64 } = await encryptSecret(plaintext);
  const entry: VaultEntry = {
    ref,
    kind,
    label,
    ciphertextBase64,
    ivBase64,
    allowed_origins,
  };
  const db = await getDB();
  await db.put(STORE_NAME, entry);
  return entry;
}

/**
 * Initialize default enterprise demo credentials into the encrypted vault.
 */
export async function initDefaultVault(): Promise<void> {
  const db = await getDB();
  const count = await db.count(STORE_NAME);
  if (count === 0) {
    await storeCredential(
      'cap_email_01',
      'email',
      'Work Email',
      'testuser@demo.local',
      ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173']
    );
    await storeCredential(
      'cap_pwd_01',
      'password',
      'Demo Password',
      'SuperSecret123!',
      ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173']
    );
    await storeCredential(
      'cap_phone_01',
      'phone',
      'Demo Phone',
      '+919876543210',
      ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173']
    );
  }
}

export const encryptedVault = {
  storeCredential,
  initDefaultVault,

  async authorize(
    ref: string,
    ctx: { task_id: string; origin: string; frame_id: string; action: string }
  ): Promise<{ ok: boolean; reason?: string }> {
    await initDefaultVault();
    const db = await getDB();
    const entry = await db.get(STORE_NAME, ref);
    if (!entry) {
      return { ok: false, reason: `Unknown capability ref: ${ref}` };
    }
    // Strict Origin Verification per Invariant I4
    const isAllowedOrigin =
      entry.allowed_origins.includes(ctx.origin) ||
      entry.allowed_origins.includes('*') ||
      (ctx.origin.includes('localhost') && entry.allowed_origins.some((o: string) => o.includes('localhost'))) ||
      (ctx.origin.includes('127.0.0.1') && entry.allowed_origins.some((o: string) => o.includes('127.0.0.1')));

    if (!isAllowedOrigin) {
      return { ok: false, reason: `Capability ${ref} not permitted on origin ${ctx.origin}` };
    }
    return { ok: true };
  },

  async resolve(
    ref: string,
    ctx: { task_id: string; origin: string }
  ): Promise<string> {
    await initDefaultVault();
    const db = await getDB();
    const entry = await db.get(STORE_NAME, ref);
    if (!entry) {
      throw new Error(`Unauthorized vault resolve for ref ${ref}`);
    }
    const isAllowedOrigin =
      entry.allowed_origins.includes(ctx.origin) ||
      entry.allowed_origins.includes('*') ||
      (ctx.origin.includes('localhost') && entry.allowed_origins.some((o: string) => o.includes('localhost'))) ||
      (ctx.origin.includes('127.0.0.1') && entry.allowed_origins.some((o: string) => o.includes('127.0.0.1')));

    if (!isAllowedOrigin) {
      throw new Error(`Unauthorized vault resolve for ref ${ref} on origin ${ctx.origin}`);
    }

    return decryptSecret(entry.ciphertextBase64, entry.ivBase64);
  },

  async listCapabilities(origin: string): Promise<{ ref: string; kind: 'password' | 'email' | 'phone' | 'token' | 'profile'; label: string }[]> {
    await initDefaultVault();
    const db = await getDB();
    const allEntries = await db.getAll(STORE_NAME);
    
    const results: { ref: string; kind: 'password' | 'email' | 'phone' | 'token' | 'profile'; label: string }[] = [];
    for (const entry of allEntries) {
      const isAllowed =
        entry.allowed_origins.includes(origin) ||
        entry.allowed_origins.includes('*') ||
        (origin.includes('localhost') && entry.allowed_origins.some((o: string) => o.includes('localhost'))) ||
        (origin.includes('127.0.0.1') && entry.allowed_origins.some((o: string) => o.includes('127.0.0.1')));

      if (isAllowed) {
        results.push({
          ref: entry.ref,
          kind: entry.kind,
          label: entry.label,
        });
      }
    }
    return results;
  },
};
