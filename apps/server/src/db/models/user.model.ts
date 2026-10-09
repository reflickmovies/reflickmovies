/**
 * The one account document.
 *
 * `mongoose` is CommonJS, so everything is reached through the default export - see the
 * note in `title.model.ts` for why a named import throws under the ESM loader.
 */
import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/** A single "this browser opened this title" row, mirrored from the local store. */
export interface WatchHistoryEntry {
  type: 'movie' | 'tv';
  slug: string;
  title: string;
  poster: string | null;
  backdrop: string | null;
  season?: number | null;
  episode?: number | null;
  watchedAt: number;
}

export interface UserDocument {
  email: string;
  displayName: string;
  passwordHash: string;
  watchHistory: WatchHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Watch history is embedded, not a second collection.
 *
 * The client store is capped at twelve rows, so an account's history is at most twelve small
 * objects. Embedding keeps a read of the account and its history to one document, which is the
 * whole reason a separate collection with a join would be worse here.
 */
const watchHistorySchema = new mongoose.Schema<WatchHistoryEntry>(
  {
    type: { type: String, required: true, enum: ['movie', 'tv'] },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    poster: { type: String, default: null },
    backdrop: { type: String, default: null },
    season: { type: Number, default: null },
    episode: { type: Number, default: null },
    watchedAt: { type: Number, required: true },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    watchHistory: { type: [watchHistorySchema], default: [] },
  },
  { versionKey: false, timestamps: true },
);

/*
  Usernames are unique, case-insensitively.

  `strength: 2` compares base letters and ignores case, so "Dune" and "dune" are the same name -
  the same rule sign-in resolves with its `i` regex. `unique: true` on the field above would get
  this wrong (it is case-sensitive). Production runs with `autoIndex` off, so `register` and
  `updateProfile` check first; this index is the guarantee under a race, not just belt-and-braces.
*/
userSchema.index({ displayName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const UserModel: Model<UserDocument> =
  (mongoose.models.User as Model<UserDocument>) ?? mongoose.model<UserDocument>('User', userSchema);
