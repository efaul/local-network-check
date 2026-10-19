/**
 * Batches samples locally and forwards them to the central server's ingest
 * endpoint. If a flush fails (server briefly unreachable), the batch is kept
 * and retried on the next tick rather than lost - bounded by `maxQueueSize`
 * so a long outage can't grow memory without limit.
 *
 * This is an in-memory buffer only; it does not survive a process restart.
 * That is a deliberate, documented limitation for this slice (see the
 * "Deferred" section of the plan) - acceptable because a survey session is a
 * single long-running foreground process, not something restarted mid-day.
 */

import type { Result } from '../shared/result.ts';
import type { IngestRequest, IngestResponse, WifiSampleDto } from '../shared/contract.js';

export type FetchFn = typeof fetch;

export interface CreateForwarderOptions {
  serverUrl: string;
  deviceId: string;
  location: string;
  maxQueueSize: number;
  log?: (message: string) => void;
  fetchFn?: FetchFn;
}

export interface Forwarder {
  addSample(result: Result): void;
  addWifiSample(sample: WifiSampleDto): void;
  flush(): Promise<boolean>;
  readonly queueSize: number;
}

export function createForwarder({
  serverUrl,
  deviceId,
  location,
  maxQueueSize,
  log = () => {},
  fetchFn = fetch,
}: CreateForwarderOptions): Forwarder {
  let samplesQueue: Result[] = [];
  let wifiQueue: WifiSampleDto[] = [];

  const cap = <T>(queue: T[], label: string): T[] => {
    if (queue.length <= maxQueueSize) return queue;
    const dropped = queue.length - maxQueueSize;
    log(`forwarder: dropping ${dropped} oldest buffered ${label} (queue over capacity)`);
    return queue.slice(dropped);
  };

  return {
    addSample(result: Result): void {
      samplesQueue.push(result);
      samplesQueue = cap(samplesQueue, 'samples');
    },

    addWifiSample(sample: WifiSampleDto): void {
      wifiQueue.push(sample);
      wifiQueue = cap(wifiQueue, 'wifi samples');
    },

    async flush(): Promise<boolean> {
      if (samplesQueue.length === 0 && wifiQueue.length === 0) return true;

      const pendingSamples = samplesQueue;
      const pendingWifi = wifiQueue;
      samplesQueue = [];
      wifiQueue = [];

      const body: IngestRequest = {
        deviceId,
        location,
        samples: pendingSamples,
        wifiSamples: pendingWifi,
      };

      try {
        const response = await fetchFn(`${serverUrl}/api/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`server responded ${response.status}`);
        }

        const result = (await response.json()) as IngestResponse;
        log(`forwarder: sent ${pendingSamples.length} samples, ${pendingWifi.length} wifi samples (accepted ${result.acceptedSamples}/${result.acceptedWifiSamples})`);
        return true;
      } catch (err) {
        log(`forwarder: flush failed, will retry: ${(err as Error).message}`);
        // Put the failed batch back ahead of anything collected meanwhile.
        samplesQueue = cap([...pendingSamples, ...samplesQueue], 'samples');
        wifiQueue = cap([...pendingWifi, ...wifiQueue], 'wifi samples');
        return false;
      }
    },

    get queueSize(): number {
      return samplesQueue.length + wifiQueue.length;
    },
  };
}
