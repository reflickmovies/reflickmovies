import { isBlockedDomain } from './blocklist.service.js';

export interface VetResult {
  blocked: boolean;
  reason?: string;
  origins: string[];
  failed: boolean;
}

export function vetOrigins(origins: string[]): VetResult {
  const seen = new Set<string>();
  const blocked = origins.find((origin) => {
    const h = origin.toLowerCase().trim();
    if (seen.has(h)) return false;
    seen.add(h);
    return isBlockedDomain(h);
  });

  if (blocked) {
    return { blocked: true, reason: `blocked: ${blocked}`, origins: [...seen], failed: false };
  }

  return { blocked: false, origins: [...seen], failed: false };
}
