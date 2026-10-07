import { env } from '../config/env.js';
import { refreshBlocklist } from '../services/blocklist.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('blocklist-refresh');

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

/**
 * The first fetch happens here rather than on the interval, so a cold boot is protected within
 * seconds instead of after a full refresh period. It is not awaited by the caller: the API must be
 * listening before a multi-megabyte download finishes, and the bundled denylist covers the gap.
 */
export async function startBlocklistRefresh(): Promise<void> {
  stopped = false;

  if (!env.ADBLOCK_ON) {
    log.warn('ADBLOCK_ON is false; only the bundled denylist is in effect');
    return;
  }

  await tick();
  schedule();
}

async function tick(): Promise<void> {
  if (running || stopped) return;

  running = true;
  try {
    await refreshBlocklist();
  } catch (error) {
    log.error('blocklist refresh failed', error);
  } finally {
    running = false;
  }
}

/**
 * Randomised first delay, exactly as `autoSync` does it: two instances started together would
 * otherwise fetch the same large lists in lockstep for the lifetime of the deployment.
 */
function schedule(): void {
  if (stopped || timer !== null) return;

  const periodMs = env.ADBLOCK_REFRESH_HOURS * 3_600_000;
  const firstDelayMs = Math.floor(Math.random() * periodMs);

  const warmup = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), periodMs);
    timer.unref();
  }, firstDelayMs);

  warmup.unref();
  timer = warmup;
}

export function stopBlocklistRefresh(): void {
  stopped = true;

  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
