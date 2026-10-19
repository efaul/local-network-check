/**
 * The dashboard and day/hour aggregation are expressed in this timezone
 * rather than UTC. Change this single constant to retarget the whole app.
 */
export const DISPLAY_TIMEZONE = 'Europe/Amsterdam';
function localParts(iso, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    // Some ICU implementations render midnight as hour "24" with hour12: false.
    if (parts.hour === '24')
        parts.hour = '00';
    return parts;
}
/** YYYY-MM-DD for the given instant, in the display timezone. */
export function localDateOf(iso, timeZone = DISPLAY_TIMEZONE) {
    const { year, month, day } = localParts(iso, timeZone);
    return `${year}-${month}-${day}`;
}
/** Hour-of-day (0-23) for the given instant, in the display timezone. */
export function localHourOf(iso, timeZone = DISPLAY_TIMEZONE) {
    return Number(localParts(iso, timeZone).hour) % 24;
}
/**
 * The UTC instant (ISO string) at which the given YYYY-MM-DD calendar date
 * begins, midnight, in the display timezone. Converges in a couple of
 * iterations regardless of DST, since the local UTC offset is at most ~14h.
 */
export function startOfLocalDay(date, timeZone = DISPLAY_TIMEZONE) {
    const [year, month, day] = date.split('-').map(Number);
    const target = Date.UTC(year, month - 1, day, 0, 0, 0);
    let guessMs = target;
    for (let i = 0; i < 3; i += 1) {
        const local = localParts(new Date(guessMs).toISOString(), timeZone);
        const localAsUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
        const diff = localAsUtc - target;
        if (diff === 0)
            break;
        guessMs -= diff;
    }
    return new Date(guessMs).toISOString();
}
/** [startIso, endIso) covering one calendar day in the display timezone. */
export function localDayRange(date, timeZone = DISPLAY_TIMEZONE) {
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDate = next.toISOString().slice(0, 10);
    return [startOfLocalDay(date, timeZone), startOfLocalDay(nextDate, timeZone)];
}
