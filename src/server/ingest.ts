/**
 * Validates and applies an ingest batch from a survey probe (or any remote
 * device). Validation failures are rejected outright (400) rather than
 * partially applied, so a malformed batch can never silently corrupt history.
 */

import { insertSample, insertWifiSample } from './db.ts';
import type { Db } from './db.ts';
import type { IngestRequest, IngestResponse, ResultDto, WifiSampleDto } from '../shared/contract.js';

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PROBE_STATES = new Set(['ok', 'timeout', 'error']);

function validateResult(value: unknown, index: number): ResultDto {
  if (!isPlainObject(value)) throw new IngestError(`samples[${index}] must be an object`);
  const { at, state, rttMs, reason } = value;

  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    throw new IngestError(`samples[${index}].at must be a valid ISO timestamp`);
  }
  if (typeof state !== 'string' || !PROBE_STATES.has(state)) {
    throw new IngestError(`samples[${index}].state must be one of ok, timeout, error`);
  }
  if (rttMs !== null && typeof rttMs !== 'number') {
    throw new IngestError(`samples[${index}].rttMs must be a number or null`);
  }
  if (state === 'ok' ? false : rttMs !== null) {
    throw new IngestError(`samples[${index}].rttMs must be null unless state is "ok"`);
  }
  if (reason !== null && typeof reason !== 'string') {
    throw new IngestError(`samples[${index}].reason must be a string or null`);
  }

  return { at: new Date(at).toISOString(), state: state as ResultDto['state'], rttMs: rttMs ?? null, reason: reason ?? null };
}

function validateWifiSample(value: unknown, index: number): WifiSampleDto {
  if (!isPlainObject(value)) throw new IngestError(`wifiSamples[${index}] must be an object`);
  const { at, connected, bssid, ssid, signalDbm, freqMhz, reason } = value;

  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    throw new IngestError(`wifiSamples[${index}].at must be a valid ISO timestamp`);
  }
  if (typeof connected !== 'boolean') {
    throw new IngestError(`wifiSamples[${index}].connected must be a boolean`);
  }
  for (const [key, val] of Object.entries({ bssid, ssid, reason })) {
    if (val !== null && val !== undefined && typeof val !== 'string') {
      throw new IngestError(`wifiSamples[${index}].${key} must be a string or null`);
    }
  }
  for (const [key, val] of Object.entries({ signalDbm, freqMhz })) {
    if (val !== null && val !== undefined && typeof val !== 'number') {
      throw new IngestError(`wifiSamples[${index}].${key} must be a number or null`);
    }
  }

  return {
    at: new Date(at).toISOString(),
    connected,
    bssid: (bssid as string | null | undefined) ?? null,
    ssid: (ssid as string | null | undefined) ?? null,
    signalDbm: (signalDbm as number | null | undefined) ?? null,
    freqMhz: (freqMhz as number | null | undefined) ?? null,
    reason: (reason as string | null | undefined) ?? null,
  };
}

export function validateIngestRequest(body: unknown): IngestRequest {
  if (!isPlainObject(body)) throw new IngestError('request body must be a JSON object');

  const { deviceId, location, samples, wifiSamples } = body;
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw new IngestError('deviceId must be a non-empty string');
  }
  if (typeof location !== 'string' || location.trim() === '') {
    throw new IngestError('location must be a non-empty string');
  }
  if (!Array.isArray(samples)) throw new IngestError('samples must be an array');
  if (wifiSamples !== undefined && !Array.isArray(wifiSamples)) {
    throw new IngestError('wifiSamples must be an array when present');
  }

  return {
    deviceId: deviceId.trim(),
    location: location.trim(),
    samples: samples.map(validateResult),
    wifiSamples: Array.isArray(wifiSamples) ? wifiSamples.map(validateWifiSample) : [],
  };
}

export function applyIngest(db: Db, request: IngestRequest): IngestResponse {
  const receivedAt = new Date().toISOString();
  let acceptedSamples = 0;
  let acceptedWifiSamples = 0;

  for (const sample of request.samples) {
    if (insertSample(db, { deviceId: request.deviceId, location: request.location, result: sample, receivedAt })) {
      acceptedSamples += 1;
    }
  }
  for (const sample of request.wifiSamples) {
    if (insertWifiSample(db, { deviceId: request.deviceId, location: request.location, sample, receivedAt })) {
      acceptedWifiSamples += 1;
    }
  }

  return { acceptedSamples, acceptedWifiSamples };
}
