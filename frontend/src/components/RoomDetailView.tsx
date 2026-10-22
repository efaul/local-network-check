import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { RoomDayDetailDocument, RoomHoursDocument } from '../types';
import { STATUS_TEXT, ms, pct, timeOf } from '../format';
import { bandOf } from '../band';
import { HourHeatmap } from './HourHeatmap';
import { SignalChart } from './SignalChart';
import { usePoll } from '../usePoll';
import { LiveIndicator } from './LiveIndicator';

/**
 * Only the most recent survey day can still receive new reports from a
 * probe that is physically in the room right now - a past day's data is
 * closed history and re-fetching it on a timer would be pure waste. Refresh
 * cadence is comfortably above the probe's real reporting cadence (30s Wi-Fi
 * sampling + 10s forwarder flush, per config/probe.json), so it won't poll
 * meaningfully faster than new data could ever arrive.
 */
const LIVE_DAY_POLL_MS = 15_000;

export function RoomDetailView({ location }: { location: string }) {
  const [dates, setDates] = useState<readonly string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [hoursDoc, setHoursDoc] = useState<RoomHoursDocument | null>(null);
  const [dayDoc, setDayDoc] = useState<RoomDayDetailDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    setDates(null);
    setDate(null);
    setHoursDoc(null);
    setDayDoc(null);
    setError(null);

    let cancelled = false;
    void (async () => {
      try {
        const doc = await api.roomDays(location);
        if (cancelled) return;
        setDates(doc.dates);
        setDate(doc.dates[0] ?? null);
        if (doc.dates.length === 0) setError('No survey data for this room yet.');
      } catch {
        if (!cancelled) setError('Could not load survey days for this room.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location]);

  // Days are returned newest-first (see RoomDaysDocument), so the live day -
  // the one a probe physically in this room could still be adding to - is
  // always the first entry.
  const isLiveDay = dates !== null && date !== null && date === dates[0];

  useEffect(() => {
    setHoursDoc(null);
    setDayDoc(null);
    setError(null);
    setRefreshFailed(false);
  }, [location, date]);

  usePoll(
    async () => {
      if (date === null) return;
      try {
        const [hours, day] = await Promise.all([api.roomHours(location, date), api.roomDay(location, date)]);
        setHoursDoc(hours);
        setDayDoc(day);
        setError(null);
        setRefreshFailed(false);
      } catch {
        setError('Could not load this day.');
        setRefreshFailed(true);
      }
    },
    date === null ? null : isLiveDay ? LIVE_DAY_POLL_MS : null,
    [location, date],
  );

  // A historical day never auto-refreshes (see isLiveDay above), so it still
  // needs exactly one load. usePoll always fires once immediately regardless
  // of whether polling is enabled - this effect only covers the case usePoll
  // intentionally skips: date !== null but isLiveDay is false.
  useEffect(() => {
    if (date === null || isLiveDay) return;
    let cancelled = false;
    void (async () => {
      try {
        const [hours, day] = await Promise.all([api.roomHours(location, date), api.roomDay(location, date)]);
        if (cancelled) return;
        setHoursDoc(hours);
        setDayDoc(day);
      } catch {
        if (!cancelled) setError('Could not load this day.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, date, isLiveDay]);

  const pointChips = useMemo(() => {
    if (dayDoc === null) return [];
    const points = new Map<string, { ssid: string | null; freqMhz: number | null }>();
    for (const sample of dayDoc.wifiSamples) {
      if (sample.connected && sample.bssid !== null) points.set(sample.bssid, { ssid: sample.ssid, freqMhz: sample.freqMhz });
    }
    return [...points.entries()].map(([bssid, info]) => {
      const band = bandOf(info.freqMhz);
      const label = [info.ssid ?? bssid, `(${bssid})`, band !== null ? `· ${band}` : null]
        .filter((part) => part !== null)
        .join(' ');
      return { bssid, label };
    });
  }, [dayDoc]);

  return (
    <div className="view-stack">
      <a className="back-link" href="#/rooms">
        ← All rooms
      </a>
      <h1>
        {location}
        {isLiveDay ? <LiveIndicator /> : null}
      </h1>

      {error !== null && dates !== null && dates.length === 0 ? (
        <p className="empty-state">{error}</p>
      ) : error !== null && dates === null ? (
        <p className="empty-state">{error}</p>
      ) : dates === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="panel">
            <div className="row-controls">
              <label htmlFor="day-select">Date: </label>
              <select id="day-select" value={date ?? ''} onChange={(e) => setDate(e.target.value)}>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {hoursDoc === null || dayDoc === null ? (
            <p className="muted">{error ?? 'Loading…'}</p>
          ) : (
            <>
              <section className="panel">
                <h2>Hour of day (Europe/Amsterdam)</h2>
                <HourHeatmap hours={hoursDoc.hours} />
              </section>

              <section className="panel">
                <h2>Wi-Fi signal strength</h2>
                {isLiveDay ? (
                  <p className="signal-refresh" role="status">
                    {refreshFailed
                      ? (error ?? 'Could not refresh this day. Retrying automatically…')
                      : 'Auto-refreshing every 15 seconds · new readings appear when the probe reports.'}
                    {dayDoc.wifiSamples.length > 0 && ` Last reading: ${timeOf(dayDoc.wifiSamples[dayDoc.wifiSamples.length - 1].at)} (Europe/Amsterdam).`}
                  </p>
                ) : (
                  <p className="signal-refresh" role="status">
                    Historical day · not auto-refreshing.
                  </p>
                )}
                <SignalChart wifiSamples={dayDoc.wifiSamples} />
              </section>

              <section className="panel">
                <h2>Day summary</h2>
                <dl className="fact-grid">
                  <div>
                    <dt>Status</dt>
                    <dd>{STATUS_TEXT[dayDoc.summary.status]}</dd>
                  </div>
                  <div>
                    <dt>Median</dt>
                    <dd>{ms(dayDoc.summary.latency.medianMs)}</dd>
                  </div>
                  <div>
                    <dt>p95</dt>
                    <dd>{ms(dayDoc.summary.latency.p95Ms)}</dd>
                  </div>
                  <div>
                    <dt>No reply</dt>
                    <dd>{pct(dayDoc.summary.lossRatio)}</dd>
                  </div>
                  <div>
                    <dt>Samples</dt>
                    <dd>{dayDoc.summary.total}</dd>
                  </div>
                </dl>
                {pointChips.length > 0 ? (
                  <>
                    <p className="muted">Access points seen this day:</p>
                    <div className="points-seen">
                      {pointChips.map((chip) => (
                        <span key={chip.bssid} className="point-chip">
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">No Wi-Fi association data recorded for this day.</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
