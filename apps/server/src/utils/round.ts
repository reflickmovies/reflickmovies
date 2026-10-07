/**
 * Rounds happen ONCE, at the mapper boundary. Nothing downstream should ever see
 * a raw float.
 *
 * Why this file exists: the reference implementation (multimovies.garden) stores
 * rating as a Postgres `double precision`, JSON-serialises it without rounding,
 * and publishes this into its structured data:
 *
 *   "ratingValue": 5.79999999999999982236431605997495353221893310546875
 *
 * Because 5.8 is not representable in IEEE-754 binary. We refuse to inherit that.
 */

/** Ratings to one decimal place, or null when there is no usable value. */
export function roundRating(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

/** Vote counts to an integer, or null. */
export function roundVoteCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** Generic two-decimal money-ish rounding, used for nothing else on purpose. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}