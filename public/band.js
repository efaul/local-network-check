/**
 * Wi-Fi band derived from the raw frequency already captured on every
 * Wi-Fi sample. This is a fixed physical fact (IEEE/ITU frequency
 * allocations) - not an estimate, and it needs no new data collection
 * since `freqMhz` is already recorded by the survey probe.
 */
const GHZ_6_FLOOR_MHZ = 5925;
const GHZ_24_CEILING_MHZ = 2500;
export function bandOf(freqMhz) {
    if (freqMhz === null || !Number.isFinite(freqMhz))
        return null;
    if (freqMhz < GHZ_24_CEILING_MHZ)
        return '2.4 GHz';
    if (freqMhz >= GHZ_6_FLOOR_MHZ)
        return '6 GHz';
    return '5 GHz';
}
