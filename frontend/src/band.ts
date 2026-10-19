/**
 * Wi-Fi band derived from the raw frequency already captured on every
 * Wi-Fi sample. A fixed physical fact (IEEE/ITU frequency allocations),
 * not an estimate.
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
