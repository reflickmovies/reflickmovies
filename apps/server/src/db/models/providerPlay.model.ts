import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * Global play counts, one row per provider key.
 *
 * The default server used to be "whichever provider the config happened to list first",
 * which is an operator's guess rather than what viewers actually use. This collection is
 * the empirical answer: every time a title's sources are resolved and a provider is
 * handed to the player, the row is incremented, and the default becomes the most-played
 * provider across all users and titles.
 *
 * A dedicated collection and a `$inc` rather than aggregating the visit or report
 * collections: those are keyed on the visitor and the title, so deriving a provider
 * leaderboard from them would be a full scan on every watch page load, and neither
 * records the same thing. A counter is one atomic update and survives restarts.
 *
 * `key` is the provider's stable key, not its display name, so renaming a provider in
 * config does not orphan its history.
 */
export interface ProviderPlayDocument {
  key: string;
  /** Total times this provider produced a usable source for any title. */
  plays: number;
  /** Bumped on each increment so a leaderboard can show recency, not just volume. */
  lastPlayedAt: Date;
}

const providerPlaySchema = new mongoose.Schema<ProviderPlayDocument>(
  {
    key: { type: String, required: true, unique: true },
    plays: { type: Number, required: true, default: 0 },
    lastPlayedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

providerPlaySchema.index({ plays: -1 });

export const ProviderPlayModel: Model<ProviderPlayDocument> =
  (mongoose.models.ProviderPlay as Model<ProviderPlayDocument>) ??
  mongoose.model<ProviderPlayDocument>('ProviderPlay', providerPlaySchema);
