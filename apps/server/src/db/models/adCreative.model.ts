import mongoose from 'mongoose';
import type { Model } from 'mongoose';

export interface AdCreativeDocument {
  key: string;
  enabled: boolean;
  type: 'image' | 'video' | 'html';
  slot: 'pre-roll' | 'post-roll' | 'interstitial' | 'banner' | 'sponsor';
  mediaUrl: string;
  clickUrl: string;
  duration: number;
  weight: number;
  canSkipAt: number | null;
  updatedAt: Date;
}

const adCreativeSchema = new mongoose.Schema<AdCreativeDocument>(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true, default: true },
    type: { type: String, required: true, enum: ['image', 'video', 'html'], default: 'image' },
    slot: { type: String, required: true, enum: ['pre-roll', 'post-roll', 'interstitial', 'banner', 'sponsor'], default: 'pre-roll' },
    mediaUrl: { type: String, required: true },
    clickUrl: { type: String, required: true },
    duration: { type: Number, required: true, default: 15 },
    weight: { type: Number, required: true, default: 1 },
    canSkipAt: { type: Number, default: null },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

adCreativeSchema.index({ enabled: 1, slot: 1 });

export const AdCreativeModel: Model<AdCreativeDocument> =
  (mongoose.models.AdCreative as Model<AdCreativeDocument>) ??
  mongoose.model<AdCreativeDocument>('AdCreative', adCreativeSchema);
