/**
 * Wire contract between the central server and the dashboard. Kept in sync
 * by hand with `../../src/shared/contract.d.ts` — duplicated (not imported)
 * so the frontend stays a self-contained Vite build with no reach-through
 * into the server's TypeScript project.
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
  readonly p98Ms: number | null;
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

export interface WifiSampleWithApNameDto extends WifiSampleDto {
  readonly apName: string | null;
}

export interface RoomSummaryDto {
  readonly location: string;
  readonly latestDate: string | null;
  readonly status: StatusName;
  readonly statusReason: string;
  readonly lastSeenAt: string | null;
  readonly isBackbone: boolean;
  readonly latestBssid: string | null;
  readonly latestSsid: string | null;
  readonly latestApName: string | null;
  readonly band: '2.4 GHz' | '5 GHz' | '6 GHz' | null;
  readonly channel: number | null;
  readonly signalDbm: number | null;
  readonly latencyP98Ms: number | null;
  readonly seenAps: readonly {
    readonly bssid: string;
    readonly ssid: string | null;
    readonly apName: string | null;
    readonly band: '2.4 GHz' | '5 GHz' | '6 GHz' | null;
    readonly lastSeenAt: string;
  }[];
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

export interface RoomHoursDocument {
  readonly location: string;
  readonly date: string;
  readonly hours: readonly HourBucketDto[];
}

export interface RoomDaysDocument {
  readonly location: string;
  readonly dates: readonly string[];
}

export interface RoomDayDetailDocument {
  readonly location: string;
  readonly date: string;
  readonly summary: {
    readonly status: StatusName;
    readonly statusReason: string;
    readonly total: number;
    readonly counts: Record<ProbeStateName, number>;
    readonly lossRatio: number | null;
    readonly latency: LatencyDto;
  };
  readonly wifiSamples: readonly WifiSampleWithApNameDto[];
}
