/**
 * Wi-Fi signal-quality bucketing, shared between the rooms list and the
 * per-day signal chart so the "good/fair/poor" thresholds live in one place.
 *
 * -60 dBm or stronger is a solid connection, -75 dBm is usable but marginal,
 * anything weaker is poor — common Wi-Fi signal quality conventions.
 */
export function signalQuality(dbm: number): 'good' | 'fair' | 'poor' {
  if (dbm >= -60) return 'good';
  if (dbm >= -75) return 'fair';
  return 'poor';
}
