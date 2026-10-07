import mongoose from 'mongoose';
import type { Model } from 'mongoose';

export interface ProviderVetDocument {
  key: string;
  providerKey: string;
  blocked: boolean;
  reason?: string;
  origins: string[];
  failed: boolean;
  attempts: number;
  lastCheckedAt: Date;
  expiresAt: Date;
}

const providerVetSchema = new mongoose.Schema<ProviderVetDocument>(
  {
    key: { type: String, required: true, unique: true },
    providerKey: { type: String, required: true },
    blocked: { type: Boolean, required: true, default: false },
    reason: { type: String, default: undefined },
    origins: { type: [String], default: [] },
    failed: { type: Boolean, required: true, default: false },
    attempts: { type: Number, required: true, default: 0 },
    lastCheckedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

providerVetSchema.index({ providerKey: 1 });
providerVetSchema.index({ expiresAt: 1 });

export const ProviderVetModel: Model<ProviderVetDocument> =
  (mongoose.models.ProviderVet as Model<ProviderVetDocument>) ??
  mongoose.model<ProviderVetDocument>('ProviderVet', providerVetSchema);
