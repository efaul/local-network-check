/**
 * The wire contract between the central server and the browser dashboard.
 *
 * Declared once, in a declaration file, so the server and the page share
 * exactly one definition without either build emitting it.
 */

export type ProbeStateName = 'ok' | 'timeout' | 'error';
export type StatusName = 'ok' | 'degraded' | 'down' | 'error' | 'unknown';

export interface ResultDto {
  readonly at: string;
  readonly state: ProbeStateName;
  readonly rttMs: number | null;
  readonly reason: string | null;
}

export interface LastResultDto extends ResultDto {
  readonly ageMs: number | null;
}

export interface LatencyDto {
  readonly sampleCount: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly minMs: number | null;
  readonly maxMs: number | null;
}

export interface WindowDto {
  readonly minutes: number;
  readonly total: number;
  readonly counts: Record<ProbeStateName, number>;
  readonly lossRatio: number | null;
  readonly latency: LatencyDto;
  readonly trailingFailureStreak: number;
}

/** GET /api/state - the backbone node's own continuous status. */
export interface BackboneStateDocument {
  readonly generatedAt: string;
  readonly node: { readonly id: string; readonly name: string; readonly location: string };
  readonly target: { readonly address: string; readonly label: string };
  readonly probe: { readonly intervalMs: number; readonly timeoutMs: number };
  readonly status: StatusName;
  readonly statusReason: string;
  readonly last: LastResultDto | null;
  readonly window: WindowDto;
  readonly recent: readonly ResultDto[];
}

export interface WifiSampleDto {
  readonly at: string;
  readonly connected: boolean;
  readonly bssid: string | null;
  readonly ssid: string | null;
  readonly signalDbm: number | null;
  readonly freqMhz: number | null;
  readonly reason: string | null;
}

/** POST /api/ingest body, sent by a survey probe (or any remote device). */
export interface IngestRequest {
  readonly deviceId: string;
  readonly location: string;
  readonly samples: readonly ResultDto[];
  readonly wifiSamples: readonly WifiSampleDto[];
}

export interface IngestResponse {
  readonly acceptedSamples: number;
  readonly acceptedWifiSamples: number;
}

/** GET /api/rooms - one row per surveyed location, most recent day only. */
export interface RoomSummaryDto {
  readonly location: string;
  readonly latestDate: string | null;
  readonly status: StatusName;
  readonly statusReason: string;
  readonly lastSeenAt: string | null;
  readonly isBackbone: boolean;
}

export interface RoomsListDocument {
  readonly rooms: readonly RoomSummaryDto[];
}

export interface HourBucketDto {
  readonly hour: number;
  readonly status: StatusName;
  readonly statusReason: string;
  readonly counts: Record<ProbeStateName, number>;
  readonly lossRatio: number | null;
  readonly latency: LatencyDto;
}

/** GET /api/rooms/:location/hours?date=YYYY-MM-DD */
export interface RoomHoursDocument {
  readonly location: string;
  readonly date: string;
  readonly hours: readonly HourBucketDto[];
}

/** GET /api/rooms/:location/days - every calendar day with data, newest first. */
export interface RoomDaysDocument {
  readonly location: string;
  readonly dates: readonly string[];
}

/** GET /api/rooms/:location/day?date=YYYY-MM-DD - full detail for one day. */
export interface RoomDayDetailDocument {
  readonly location: string;
  readonly date: string;
  readonly summary: {
    readonly status: StatusName;
    readonly statusReason: string;
    readonly counts: Record<ProbeStateName, number>;
    readonly lossRatio: number | null;
    readonly latency: LatencyDto;
  };
  readonly samples: readonly ResultDto[];
  readonly wifiSamples: readonly WifiSampleDto[];
}
