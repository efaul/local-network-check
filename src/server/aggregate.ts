/**
 * Turns raw rows into the room-list / heatmap / day-detail documents the
 * dashboard renders. The backbone node is just another location that happens
 * to update continuously - its status reflects live freshness; every other
 * location is historical, and its status reflects its latest full day.
 */

import {
  distinctLocations,
  lastSampleForDevice,
  lastSampleForLocation,
  latestDateForLocation,
  datesForLocation,
  lastConnectedWifiSampleForLocation,
  distinctConnectedApsForLocation,
  recentSamplesForDevice,
  samplesForLocationAndDate,
  wifiSamplesForLocationAndDate,
} from './db.ts';
import type { Db } from './db.ts';
import { summarise, summariseByHour, deriveStatus, deriveBucketStatus } from '../shared/summary.ts';
import { localDateOf } from '../shared/timezone.ts';
import { bandOf, channelOf } from '../shared/band.ts';
import { resolveApName } from '../shared/apNames.ts';
import type {
  HourBucketDto,
  RoomDayDetailDocument,
  RoomDaysDocument,
  RoomHoursDocument,
  RoomSummaryDto,
} from '../shared/contract.js';

export interface GetRoomsListOptions {
  backboneDeviceId: string;
  backboneLocation: string;
  windowMs: number;
  intervalMs: number;
  apNames: Readonly<Record<string, string>>;
}

export function getRoomsList(db: Db, options: GetRoomsListOptions): RoomSummaryDto[] {
  const locations = distinctLocations(db);

  return locations.map((location) => {
    const isBackbone = location === options.backboneLocation;
    const latestWifi = lastConnectedWifiSampleForLocation(db, location);
    const latestBssid = latestWifi?.bssid ?? null;
    const wifiFields = {
      latestBssid,
      latestSsid: latestWifi?.ssid ?? null,
      latestApName: resolveApName(options.apNames, latestBssid),
      band: bandOf(latestWifi?.freqMhz ?? null),
      channel: channelOf(latestWifi?.freqMhz ?? null),
      signalDbm: latestWifi?.signalDbm ?? null,
      seenAps: distinctConnectedApsForLocation(db, location).map((ap) => ({
        bssid: ap.bssid,
        ssid: ap.ssid,
        apName: resolveApName(options.apNames, ap.bssid),
        band: bandOf(ap.freqMhz),
        lastSeenAt: ap.lastSeenAt,
      })),
    };

    if (isBackbone) {
      const since = new Date(Date.now() - options.windowMs).toISOString();
      const results = recentSamplesForDevice(db, options.backboneDeviceId, since);
      const last = lastSampleForDevice(db, options.backboneDeviceId);
      const summary = summarise(results);
      const { status, reason } = deriveStatus({ last, summary, intervalMs: options.intervalMs });

      return {
        location,
        latestDate: last ? localDateOf(last.at) : null,
        status,
        statusReason: reason,
        lastSeenAt: last?.at ?? null,
        isBackbone: true,
        latencyP98Ms: summary.latency.p98Ms,
        ...wifiFields,
      };
    }

    const latestDate = latestDateForLocation(db, location);
    const last = lastSampleForLocation(db, location);
    const dayResults = latestDate ? samplesForLocationAndDate(db, location, latestDate) : [];
    const summary = summarise(dayResults);
    const { status, reason } = deriveBucketStatus(summary);

    return {
      location,
      latestDate,
      status,
      statusReason: reason,
      lastSeenAt: last?.at ?? null,
      isBackbone: false,
      latencyP98Ms: summary.latency.p98Ms,
      ...wifiFields,
    };
  });
}

export function getHoursForDay(db: Db, location: string, date: string): RoomHoursDocument {
  const results = samplesForLocationAndDate(db, location, date);
  const buckets = summariseByHour(results);

  const hours: HourBucketDto[] = buckets.map(({ hour, summary, status }) => ({
    hour,
    status: status.status,
    statusReason: status.reason,
    counts: summary.counts,
    lossRatio: summary.lossRatio,
    latency: summary.latency,
  }));

  return { location, date, hours };
}

export function getDaysForLocation(db: Db, location: string): RoomDaysDocument {
  return { location, dates: datesForLocation(db, location) };
}

export function getDayDetail(
  db: Db,
  location: string,
  date: string,
  apNames: Readonly<Record<string, string>>,
): RoomDayDetailDocument {
  const samples = samplesForLocationAndDate(db, location, date);
  const rawWifiSamples = wifiSamplesForLocationAndDate(db, location, date);
  const wifiSamples = rawWifiSamples.map((sample) => ({
    ...sample,
    apName: resolveApName(apNames, sample.bssid),
  }));
  const summary = summarise(samples);
  const { status, reason } = deriveBucketStatus(summary);

  return {
    location,
    date,
    summary: {
      status,
      statusReason: reason,
      total: summary.total,
      counts: summary.counts,
      lossRatio: summary.lossRatio,
      latency: summary.latency,
    },
    wifiSamples,
  };
}
