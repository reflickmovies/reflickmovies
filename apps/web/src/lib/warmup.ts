import { getHealth } from './api';

/**
 * Kick the API awake the moment the app boots.
 *
 * On Render's free plan the API container is spun down after ~15 idle minutes, and the first
 * request after that is held until the container boots - 30-60s. Without this, that wait lands
 * after the browser has parsed and rendered the shell, so the reader watches an empty page while
 * the first data request sits on the cold start. Firing a throwaway health request here overlaps
 * the boot with the app's own first paint instead.
 *
 * Fire-and-forget and never throws: when the API is already warm this is one cheap round-trip, and
 * when it is down the real requests will surface that. A warm-up must not become a second failure
 * path, so nothing awaits it and nothing reads the result.
 */
export function warmApi(): void {
  void getHealth().catch(() => undefined);
}
