import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf } from '../src/shared/band.ts';

test('2.4 GHz channels (1-14) map to 2.4 GHz', () => {
  assert.equal(bandOf(2412), '2.4 GHz'); // channel 1
  assert.equal(bandOf(2484), '2.4 GHz'); // channel 14
});

test('5 GHz channels map to 5 GHz', () => {
  assert.equal(bandOf(5180), '5 GHz'); // channel 36
  assert.equal(bandOf(5825), '5 GHz'); // just below the 6 GHz floor
});

test('6 GHz channels (Wi-Fi 6E) map to 6 GHz, not 5 GHz', () => {
  assert.equal(bandOf(5925), '6 GHz'); // exact floor
  assert.equal(bandOf(6115), '6 GHz');
});

test('missing or non-finite frequency yields no band, not a guess', () => {
  assert.equal(bandOf(null), null);
  assert.equal(bandOf(Number.NaN), null);
});
