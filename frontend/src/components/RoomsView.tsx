import { useState } from 'react';
import { api } from '../api';
import type { RoomSummaryDto } from '../types';
import { dateTimeOf, timeAgoFromIso, ms, networkLabel } from '../format';
import { signalQuality } from '../signal';
import { roomLink } from '../router';
import { StatusBadge } from './StatusBadge';
import { usePoll } from '../usePoll';
import { LiveIndicator } from './LiveIndicator';

/**
 * Survey data can't change faster than the probe's own reporting cadence
 * (30s Wi-Fi sampling + 10s forwarder flush, per config/probe.json), so
 * polling faster than that would only ever re-fetch identical data.
 */
const POLL_MS = 20_000;

function roomCountLabel(n: number): string {
  return n === 1 ? '1 location' : `${n} locations`;
}

/** Band only, for now - channel number (room.channel) is computed and available, just not shown in this column yet. */
function channelBandLabel(room: RoomSummaryDto): string {
  return room.band ?? '—';
}

function NetworkCell({ room }: { room: RoomSummaryDto }) {
  if (room.latestBssid === null) {
    return <span className="muted">No Wi-Fi data</span>;
  }
  return <span className="point-chip">{networkLabel(room.latestSsid, room.latestBssid, room.latestApName)}</span>;
}

function SignalCell({ room }: { room: RoomSummaryDto }) {
  if (room.signalDbm === null) return <span className="muted">—</span>;
  return (
    <span>
      <span className={`key key-${signalQuality(room.signalDbm)}`} /> {room.signalDbm.toFixed(0)} dBm
    </span>
  );
}

export function RoomsView() {
  const [rooms, setRooms] = useState<readonly RoomSummaryDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  usePoll(async () => {
    try {
      const { rooms } = await api.rooms();
      setRooms(rooms);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, POLL_MS);

  if (failed && rooms === null) return <p className="empty-state">Could not load rooms from the server.</p>;
  if (rooms === null) return <p className="muted">Loading…</p>;

  if (rooms.length === 0) {
    return (
      <div>
        <h1>Rooms</h1>
        <p className="empty-state">No rooms surveyed yet. Run the probe in a room to see it here.</p>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <div>
        <h1>
          Rooms
          <LiveIndicator />
        </h1>
        <p className="subtitle">
          {roomCountLabel(rooms.length)}
          {failed ? <span className="muted"> · last update failed, showing previous data</span> : null}
        </p>
      </div>

      <div className="room-matrix-scroll">
        <table className="room-matrix">
          <thead>
            <tr>
              <th>Room</th>
              <th>Status</th>
              <th>Band</th>
              <th>Network</th>
              <th>Signal</th>
              <th>p98</th>
              <th>Last sample</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.location} className={`status-${room.status}`}>
                <td className="room-matrix-name">
                  <a href={roomLink(room.location)}>{room.location}</a>
                </td>
                <td>
                  <StatusBadge status={room.status} />
                </td>
                <td>{channelBandLabel(room)}</td>
                <td>
                  <NetworkCell room={room} />
                </td>
                <td>
                  <SignalCell room={room} />
                </td>
                <td className="muted">{ms(room.latencyP98Ms)}</td>
                <td className="muted" title={dateTimeOf(room.lastSeenAt)}>
                  {timeAgoFromIso(room.lastSeenAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
