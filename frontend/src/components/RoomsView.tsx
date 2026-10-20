import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RoomSummaryDto } from '../types';
import { timeAgoFromIso } from '../format';
import { signalQuality } from '../signal';
import { roomLink } from '../router';
import { StatusBadge } from './StatusBadge';

function roomCountLabel(n: number): string {
  return n === 1 ? '1 location' : `${n} locations`;
}

function RoomWifiCell({ room }: { room: RoomSummaryDto }) {
  if (room.latestBssid === null) {
    return (
      <div className="room-wifi">
        <span className="muted">No Wi-Fi data</span>
      </div>
    );
  }

  const quality = room.signalDbm !== null ? signalQuality(room.signalDbm) : 'none';
  const apLabel = room.latestSsid ?? room.latestBssid;
  const signalLabel = room.signalDbm !== null ? `${room.signalDbm.toFixed(0)} dBm` : '—';

  return (
    <div className="room-wifi">
      <span className={`key key-${quality}`} />
      <span className="point-chip">{apLabel}</span>
      {room.band !== null ? <span className="point-chip">{room.band}</span> : null}
      <span className="muted">{signalLabel}</span>
    </div>
  );
}

export function RoomsView() {
  const [rooms, setRooms] = useState<readonly RoomSummaryDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { rooms } = await api.rooms();
        if (!cancelled) setRooms(rooms);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <p className="empty-state">Could not load rooms from the server.</p>;
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
        <h1>Rooms</h1>
        <p className="subtitle">{roomCountLabel(rooms.length)}</p>
      </div>
      <div className="rooms-list">
        {rooms.map((room) => (
          <a key={room.location} className={`room-row status-${room.status}`} href={roomLink(room.location)}>
            <div>
              <div className="room-name">{room.location}</div>
              <div className="room-meta">
                {room.isBackbone ? 'Continuous backbone reference' : `Last surveyed: ${timeAgoFromIso(room.lastSeenAt)}`}
              </div>
              <RoomWifiCell room={room} />
            </div>
            <StatusBadge status={room.status} />
          </a>
        ))}
      </div>
    </div>
  );
}
