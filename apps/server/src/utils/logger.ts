import { env } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = ORDER[env.LOG_LEVEL];

const PAINT: Record<Level, string> = {
  debug: '[38;5;244m',
  info: '[38;5;250m',
  warn: '[38;5;179m',
  error: '[38;5;174m',
};
const RESET = '[0m';
const DIM = '[2m';

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (ORDER[level] < THRESHOLD) return;

  const time = new Date().toISOString().slice(11, 23);
  const line = `${DIM}${time}${RESET} ${PAINT[level]}${level.toUpperCase().padEnd(5)}${RESET} ${DIM}[${scope}]${RESET} ${message}`;

  if (meta === undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](line);
    return;
  }

  const tail = meta instanceof Error ? meta.message : JSON.stringify(meta);
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`${line} ${DIM}${tail}${RESET}`);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: unknown) => emit('debug', scope, message, meta),
    info: (message: string, meta?: unknown) => emit('info', scope, message, meta),
    warn: (message: string, meta?: unknown) => emit('warn', scope, message, meta),
    error: (message: string, meta?: unknown) => emit('error', scope, message, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export const logger = createLogger('reflick');