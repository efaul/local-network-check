import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { RoomDayDetailDocument, RoomHoursDocument } from '../types';
import { STATUS_TEXT, ms, pct, timeOf } from '../format';
import { bandOf } from '../band';
import { HourHeatmap } from './HourHeatmap';
import { SignalChart } from './SignalChart';

export function RoomDetailView({ location }: { location: string }) {
  const [dates, setDates] = useState<readonly string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [hoursDoc, setHoursDoc] = useState<RoomHoursDocument | null>(null);
  const [dayDoc, setDayDoc] = useState<RoomDayDetailDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);

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

  useEffect(() => {
    if (date === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setHoursDoc(null);
    setDayDoc(null);
    setError(null);
    setRefreshError(false);
    const refresh = async () => {
      try {
        const [hours, day] = await Promise.all([api.roomHours(location, date), api.roomDay(location, date)]);
        if (cancelled) return;
        setHoursDoc(hours);
        setDayDoc(day);
        setError(null);
        setRefreshError(false);
      } catch {
        if (!cancelled) {
          setError('Could not refresh this day. Retrying automatically…');
          setRefreshError(true);
        }
      } finally {
        // Schedule after completion so slower requests never overlap.
        if (!cancelled) timer = setTimeout(() => { void refresh(); }, 2000);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location, date]);

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
      <h1>{location}</h1>

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
                <p className="signal-refresh" role="status">
                  {refreshError ? error : 'Auto-refreshing every 2 seconds · new readings appear when the probe reports.'}
                  {dayDoc.wifiSamples.length > 0 && ` Last reading: ${timeOf(dayDoc.wifiSamples[dayDoc.wifiSamples.length - 1].at)} (Europe/Amsterdam).`}
                </p>
                <SignalChart wifiSamples={dayDoc.wifiSamples} />
                <p className="legend">
                  <span className="key key-fair" /> fair{' '}
                  <span className="key key-poor" /> poor <span className="key key-none" /> disconnected
                </p>
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
                    <dd>{dayDoc.samples.length}</dd>
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
