import type {
  BackboneStateDocument,
  RoomDayDetailDocument,
  RoomDaysDocument,
  RoomHoursDocument,
  RoomsListDocument,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  backboneState: (): Promise<BackboneStateDocument> => getJson('/api/state'),
  rooms: (): Promise<RoomsListDocument> => getJson('/api/rooms'),
  roomDays: (location: string): Promise<RoomDaysDocument> =>
    getJson(`/api/rooms/${encodeURIComponent(location)}/days`),
  roomHours: (location: string, date: string): Promise<RoomHoursDocument> =>
    getJson(`/api/rooms/${encodeURIComponent(location)}/hours?date=${date}`),
  roomDay: (location: string, date: string): Promise<RoomDayDetailDocument> =>
    getJson(`/api/rooms/${encodeURIComponent(location)}/day?date=${date}`),
};
