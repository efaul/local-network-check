import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RoomSummaryDto } from '../types';
import { timeAgoFromIso } from '../format';
import { roomLink } from '../router';
import { StatusBadge } from './StatusBadge';

function roomCountLabel(n: number): string {
  return n === 1 ? '1 location' : `${n} locations`;
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
            </div>
            <StatusBadge status={room.status} />
          </a>
        ))}
      </div>
    </div>
  );
}
