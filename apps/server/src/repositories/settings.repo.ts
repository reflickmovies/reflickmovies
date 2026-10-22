import { SettingModel } from '../db/models/index.js';
import { mostPlayedProviderKey } from './playCounts.repo.js';
import { listProviders } from './providers.repo.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('settings');

/**
 * Operator overrides, kept small and typed at the edges.
 *
 * Everything a deploy-once operator sets belongs in an environment variable. This module
 * is for the choices made at runtime from the dashboard. Each key gets its own accessor
 * pair rather than a generic get/set, so the value's shape is checked in one place and a
 * typo in a key string cannot silently write to a row nobody reads.
 */

const DEFAULT_PROVIDER_KEY = 'defaultProvider';
/** Stored when the operator explicitly wants "no override", distinct from "never set". */
const AUTO = '__auto__';

export async function getDefaultProviderOverride(): Promise<string | null> {
  const row = await SettingModel.findOne({ key: DEFAULT_PROVIDER_KEY }, { _id: 0, value: 1 }).lean<{
    value: unknown;
  } | null>();

  const value = row?.value;
  if (typeof value !== 'string' || value.length === 0 || value === AUTO) return null;
  return value;
}

/**
 * Sets or clears the override.
 *
 * `null` writes the sentinel rather than deleting the row: "the operator chose automatic"
 * and "the operator has never opened this panel" are different states, and only one of
 * them should be reported as untouched in the dashboard.
 */
export async function setDefaultProviderOverride(key: string | null): Promise<void> {
  await SettingModel.updateOne(
    { key: DEFAULT_PROVIDER_KEY },
    { $set: { value: key ?? AUTO, updatedAt: new Date() } },
    { upsert: true },
  );
}

export interface DefaultProviderResolution {
  /** The provider key to lead with, or `null` when nothing is configured or played. */
  key: string | null;
  /** How this value was chosen, so the dashboard can explain it. */
  source: 'override' | 'most-played' | 'fallback' | 'none';
}

/**
 * Which provider a watch page should lead with.
 *
 * Three-tier, in priority order:
 *   1. an operator override, when one is set - the dashboard's explicit choice;
 *   2. the most-played provider globally, which is the product's stated default;
 *   3. the first enabled provider in the configured order, so a brand-new deployment
 *      still has a sensible lead before anyone has played anything.
 *
 * A key that no longer matches an enabled provider is ignored at every tier: a provider
 * can be removed from config, and the default must never point at something that cannot
 * serve.
 */
export async function resolveDefaultProvider(): Promise<DefaultProviderResolution> {
  const providers = await listProviders();
  const enabled = new Set(providers.map((provider) => provider.key));

  try {
    const override = await getDefaultProviderOverride();
    if (override !== null && enabled.has(override)) {
      return { key: override, source: 'override' };
    }

    const mostPlayed = await mostPlayedProviderKey();
    if (mostPlayed !== null && enabled.has(mostPlayed)) {
      return { key: mostPlayed, source: 'most-played' };
    }
  } catch (error) {
    // A database hiccup here must not stop a title from resolving; fall through to the
    // configured order, which needs no query at all.
    log.warn('default provider resolution fell back', error);
  }

  const fallback = providers[0]?.key ?? null;
  return { key: fallback, source: fallback === null ? 'none' : 'fallback' };
}
