/**
 * Wi-Fi band derived from the raw frequency already captured on every
 * Wi-Fi sample. This is a fixed physical fact (IEEE/ITU frequency
 * allocations) - not an estimate, and it needs no new data collection
 * since `freqMhz` is already recorded by the survey probe.
 *
 * Deliberately duplicated in `../web/band.ts`: the web bundle's `rootDir`
 * keeps it self-contained (see the comment in `src/web/app.ts`), so this
 * copy exists for server-side code that aggregates the same data.
 */

export type WifiBand = '2.4 GHz' | '5 GHz' | '6 GHz';

const GHZ_6_FLOOR_MHZ = 5925;
const GHZ_24_CEILING_MHZ = 2500;

export function bandOf(freqMhz: number | null): WifiBand | null {
  if (freqMhz === null || !Number.isFinite(freqMhz)) return null;
  if (freqMhz < GHZ_24_CEILING_MHZ) return '2.4 GHz';
  if (freqMhz >= GHZ_6_FLOOR_MHZ) return '6 GHz';
  return '5 GHz';
}
