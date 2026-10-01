/**
 * Compute SHA-256 hex digest using Web Crypto API.
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministically serialize a JavaScript value to JSON (sorted keys)
 * for reliable cryptographic hashing.
 */
export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => {
    const val = obj[key];
    return JSON.stringify(key) + ':' + canonicalJson(val);
  });
  return '{' + pairs.join(',') + '}';
}
