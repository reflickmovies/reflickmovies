/**
 * A stable, per-browser visitor id.
 *
 * "How many people visited" cannot be answered by IP alone: a shared office connection is one
 * IP with many people behind it, and a phone that moves between Wi-Fi and cellular is one person
 * across several IPs. A UUID minted once and kept in `localStorage` is one identity per browser
 * profile, which is the closest a cookieless beacon can get to "one visitor" and is what the
 * dashboard counts uniques on.
 *
 * Deliberately best-effort, like the rest of the browser stores here: `localStorage` is absent
 * in SSR and throws in private mode, so an unavailable store degrades to a id that lasts only
 * for the page rather than breaking tracking or the page load. In that case the server falls
 * back to counting the row by IP, which is exactly the pre-existing behaviour.
 */

const STORAGE_KEY = 'reflick:device-id:v1';

/** Session-scoped fallback when `localStorage` cannot be written: stable for this tab only. */
let ephemeralId: string | null = null;

function mint(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Older engines: 128 bits of randomness formatted like a v4 UUID. Not a security boundary,
  // just an identifier, so `Math.random` is acceptable here.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** This browser's visitor id, minting and persisting one on first call. */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing !== null && existing.length > 0) return existing;

    const created = mint();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    /* Private mode or a full store: keep the id only for this session. */
    if (ephemeralId === null) ephemeralId = mint();
    return ephemeralId;
  }
}
