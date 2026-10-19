/**
 * Single ping-based reachability probe. Shared by the backbone node and the
 * survey probe — the measurement is identical, only the target differs.
 *
 * - No shell is used, so the target string can never be interpreted as a command.
 * - `ping` gets its own timeout flag, and a slightly longer hard timeout is kept
 *   as a backstop so a wedged child process can never stall the schedule.
 * - A failure to run the probe (`error`) is kept strictly separate from a probe
 *   that ran and got no reply (`timeout`). Confusing the two would turn a
 *   broken monitor into fake packet loss.
 * - `ping` exit codes differ by platform: macOS uses 2 for "no reply" (and 68
 *   for an unresolvable host); Linux uses 1 for "no reply" and 2 for failure.
 *   Verified against the real binaries on both platforms.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { ok, timeout, failure } from './result.ts';
import type { Result } from './result.ts';

/** Extra time allowed beyond ping's own timeout before we kill the child. */
export const HARD_TIMEOUT_GRACE_MS = 750;

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface RunPingOptions {
  target: string;
  timeoutMs: number;
  platform?: NodeJS.Platform | string;
  spawnFn?: SpawnFn;
  signal?: AbortSignal;
  now?: () => Date;
}

/**
 * `-W` means milliseconds on macOS but whole seconds on Linux, so the flag has
 * to be built per platform. `-n` avoids reverse-DNS lookups delaying a reply.
 */
export function buildPingArgs(target: string, timeoutMs: number, platform: string = process.platform): string[] {
  if (platform === 'darwin') {
    return ['-c', '1', '-n', '-W', String(Math.max(1, Math.round(timeoutMs))), target];
  }
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return ['-c', '1', '-n', '-W', String(seconds), target];
}

/** Pulls the round-trip time out of ping's output, e.g. "time=9.882 ms". */
export function parseRttMs(stdout: string): number | null {
  const match = /time[=<]\s*([0-9]+(?:\.[0-9]+)?)\s*ms/i.exec(String(stdout));
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

export function classifyExitCode(
  code: number | null,
  platform: string = process.platform,
): 'ok' | 'timeout' | 'error' {
  if (code === 0) return 'ok';
  if (platform === 'darwin') return code === 2 ? 'timeout' : 'error';
  return code === 1 ? 'timeout' : 'error';
}

const firstLine = (text: string): string =>
  String(text).split('\n').map((line) => line.trim()).find(Boolean) ?? '';

/** Always resolves, never rejects. */
export function runPing({
  target,
  timeoutMs,
  platform = process.platform,
  spawnFn = spawn as SpawnFn,
  signal,
  now = () => new Date(),
}: RunPingOptions): Promise<Result> {
  return new Promise<Result>((resolve) => {
    const at = now();
    const args = buildPingArgs(target, timeoutMs, platform);

    let settled = false;
    const settle = (result: Result): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawnFn('ping', args, {
        timeout: timeoutMs + HARD_TIMEOUT_GRACE_MS,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      });
    } catch (err) {
      settle(failure(`probe-could-not-start: ${(err as Error).message}`, at));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.name === 'AbortError') {
        settle(failure('probe-aborted', at));
        return;
      }
      const reason = err.code === 'ENOENT' ? 'ping-command-not-found' : `probe-failed: ${err.message}`;
      settle(failure(reason, at));
    });

    child.on('close', (code: number | null, closeSignal: NodeJS.Signals | null) => {
      if (closeSignal) {
        settle(timeout('probe-timeout', at));
        return;
      }

      if (code === 0) {
        const rttMs = parseRttMs(stdout);
        settle(
          rttMs === null
            ? ok(null, at, 'reply-received-but-rtt-unreadable')
            : ok(rttMs, at),
        );
        return;
      }

      if (classifyExitCode(code, platform) === 'timeout') {
        settle(timeout('no-reply', at));
        return;
      }

      settle(failure(firstLine(stderr) || `ping-exit-${code}`, at));
    });
  });
}
