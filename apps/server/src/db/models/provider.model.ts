import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { IdSpace } from '../../domain/types.js';

/**
 * Embed providers are operator configuration, not catalogue data: TMDB knows
 * nothing about them. They live in their own collection and are loaded from
 * `config/providers.json` via `npm run providers:import`, so enabling or
 * removing a provider is a configuration change and never a code change.
 */
export interface ProviderDocument {
  key: string;
  name: string;
  badge: string | null;
  priority: number;
  idSpace: IdSpace;
  urlTemplate: string;
  hosts: string[];
  enabled: boolean;
  kinds: Array<'movie' | 'tv'>;
  updatedAt: Date;
}

const providerSchema = new mongoose.Schema<ProviderDocument>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    badge: { type: String, default: null },
    priority: { type: Number, required: true, default: 100 },
    idSpace: { type: String, required: true, enum: ['tmdb', 'imdb', 'slug'] },
    urlTemplate: { type: String, required: true },
    hosts: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    kinds: { type: [String], enum: ['movie', 'tv'], default: ['movie', 'tv'] },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

providerSchema.index({ enabled: 1, priority: 1 });

export const ProviderModel: Model<ProviderDocument> =
  (mongoose.models.Provider as Model<ProviderDocument>) ?? mongoose.model<ProviderDocument>('Provider', providerSchema);