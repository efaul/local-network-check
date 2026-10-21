/**
 * Wi-Fi band derived from the raw frequency already captured on every
 * Wi-Fi sample. This is a fixed physical fact (IEEE/ITU frequency
 * allocations) - not an estimate, and it needs no new data collection
 * since `freqMhz` is already recorded by the survey probe.
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

/**
 * Wi-Fi channel number derived from the same raw frequency as {@link bandOf}
 * - also a fixed physical fact, not a measurement or an estimate.
 *
 * Each band uses its own fixed spacing:
 * - 2.4 GHz: 5 MHz steps from channel 1 at 2412 MHz, except channel 14
 *   (2484 MHz), which sits off that grid and must be matched exactly.
 * - 5 GHz: 5 MHz steps from a 5000 MHz base (so 5180 MHz is channel 36).
 * - 6 GHz: channel 1 starts at 5955 MHz, numbered in 5 MHz steps up to
 *   channel 233 at 7115 MHz (so 6115 MHz is channel 33). 5925-5954 MHz is
 *   inside the 6 GHz band `bandOf` reports, but is a guard range with no
 *   channel 1-233 mapping - a formula applied there would produce a
 *   negative "channel", so it is treated the same as an unknown frequency.
 *
 * Returns null for anything outside these known ranges rather than a
 * number computed from a formula that does not apply there - a wrong
 * channel number would be worse than an honest gap.
 */
export function channelOf(freqMhz: number | null): number | null {
  if (freqMhz === null || !Number.isFinite(freqMhz)) return null;

  if (freqMhz === 2484) return 14;
  if (freqMhz >= 2412 && freqMhz <= 2472) return (freqMhz - 2407) / 5;
  if (freqMhz >= 5000 && freqMhz < GHZ_6_FLOOR_MHZ) return (freqMhz - 5000) / 5;
  if (freqMhz >= 5955 && freqMhz <= 7115) return (freqMhz - 5950) / 5;

  return null;
}
