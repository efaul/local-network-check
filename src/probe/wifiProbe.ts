/**
 * Wi-Fi association collector for the survey probe, using Linux `iw`.
 *
 * This is deliberately Linux-only (no macOS fallback): the Raspberry Pi is the
 * instrument precisely because `iw` gives reliable, permission-free BSSID and
 * signal data, unlike macOS's locked-down Wi-Fi diagnostics tools.
 *
 * Always resolves, never rejects - a parse failure or missing `iw` is
 * reported as a disconnected/unavailable sample, never thrown.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { WifiSampleDto } from '../shared/contract.js';

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface RunWifiScanOptions {
  iface: string;
  timeoutMs?: number;
  spawnFn?: SpawnFn;
  now?: () => Date;
}

const BSSID_RE = /^Connected to ([0-9a-fA-F:]{17})/m;
const SSID_RE = /^\s*SSID:\s*(.+)$/m;
const FREQ_RE = /^\s*freq:\s*(\d+)/m;
const SIGNAL_RE = /^\s*signal:\s*(-?\d+)\s*dBm/m;

export function parseIwLinkOutput(stdout: string): Omit<WifiSampleDto, 'at'> {
  if (/^Not connected\.?/m.test(stdout)) {
    return { connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: 'not-connected' };
  }

  const bssid = BSSID_RE.exec(stdout)?.[1] ?? null;
  if (bssid === null) {
    return { connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: 'unreadable-output' };
  }

  const ssid = SSID_RE.exec(stdout)?.[1]?.trim() ?? null;
  const freqMatch = FREQ_RE.exec(stdout)?.[1];
  const signalMatch = SIGNAL_RE.exec(stdout)?.[1];
  const freqMhz = freqMatch !== undefined ? Number(freqMatch) : null;
  const signalDbm = signalMatch !== undefined ? Number(signalMatch) : null;

  return { connected: true, bssid: bssid.toLowerCase(), ssid, signalDbm, freqMhz, reason: null };
}

export function runWifiScan({
  iface,
  timeoutMs = 2000,
  spawnFn = spawn as SpawnFn,
  now = () => new Date(),
}: RunWifiScanOptions): Promise<WifiSampleDto> {
  return new Promise<WifiSampleDto>((resolve) => {
    const at = now().toISOString();

    let settled = false;
    const settle = (partial: Omit<WifiSampleDto, 'at'>): void => {
      if (settled) return;
      settled = true;
      resolve({ at, ...partial });
    };

    let child: ChildProcess;
    try {
      child = spawnFn('iw', ['dev', iface, 'link'], {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settle({ connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: `could-not-start: ${(err as Error).message}` });
      return;
    }

    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });

    child.on('error', (err: NodeJS.ErrnoException) => {
      const reason = err.code === 'ENOENT' ? 'iw-not-available' : `failed: ${err.message}`;
      settle({ connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason });
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        settle({ connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: 'scan-timeout' });
        return;
      }
      if (code !== 0) {
        settle({ connected: false, bssid: null, ssid: null, signalDbm: null, freqMhz: null, reason: `iw-exit-${code}` });
        return;
      }
      settle(parseIwLinkOutput(stdout));
    });
  });
}
