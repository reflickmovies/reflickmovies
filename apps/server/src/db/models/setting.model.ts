import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * Operator-set key/value settings that must survive a redeploy.
 *
 * Tiny on purpose. This is not a general config store - environment variables hold
 * everything an operator sets once at deploy time. What lives here is the handful of
 * choices that are made *from the dashboard at runtime* and would otherwise reset on the
 * next deploy. The first of them is the default-provider override.
 */
export interface SettingDocument {
  key: string;
  value: unknown;
  updatedAt: Date;
}

const settingSchema = new mongoose.Schema<SettingDocument>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false, minimize: false },
);

export const SettingModel: Model<SettingDocument> =
  (mongoose.models.Setting as Model<SettingDocument>) ??
  mongoose.model<SettingDocument>('Setting', settingSchema);
