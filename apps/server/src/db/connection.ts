import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mongo');

mongoose.set('strictQuery', true);

/**
 * The single database connection.
 *
 * There is deliberately no in-memory fallback. A streaming site that silently
 * serves an empty catalogue when Mongo is down is worse than one that refuses to
 * start: the failure is loud and immediate instead of showing up as "no results".
 */
export async function connectToDatabase(uri = env.MONGODB_URI, dbName = env.MONGODB_DB_NAME): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  await mongoose.connect(uri, {
    dbName,
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    autoIndex: !env.NODE_ENV || env.NODE_ENV === 'development',
  });

  mongoose.connection.on('connected', () => log.info(`connected to ${dbName}`));
  mongoose.connection.on('disconnected', () => log.warn('disconnected'));
  mongoose.connection.on('error', (error: unknown) => log.error('connection error', error));

  return mongoose;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

const CONNECTION_STATES: Record<number, DatabaseState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

export const databaseState = (): DatabaseState =>
  CONNECTION_STATES[mongoose.connection.readyState] ?? 'disconnected';

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;

export { mongoose };